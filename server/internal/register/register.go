// Package register is Lampas self-registration (the epic mw-cvwm1u): a person
// proves an email and a phone with Twilio Verify and the backend keeps who
// they are as keyed fingerprints only, with up to three device keys that
// share one daily budget. Each email and each phone is one person's.
//
// Nothing here writes an email or a phone to disk or to the log. A pending
// registration holds them in memory for ten minutes, because Twilio's check
// needs the address again, and drops them at the first final answer.
package register

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net/mail"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/auth"
)

const (
	// KeyFile is the fingerprint key's name under POSTERN_DATA.
	KeyFile = "postern-register.key"

	// MaxDevices is how many keys one licence may hold.
	MaxDevices = 3
	// DefaultDailyLimit is a new person's tutor answers a day, shared by
	// their devices.
	DefaultDailyLimit = 50
	// MaxTries is how many wrong confirms kill a registration.
	MaxTries = 5
	// TTL is how long a registration may wait for its codes.
	TTL = 10 * time.Minute

	// DefaultStartsPerHour and DefaultConfirmsPerHour are the per-IP limits.
	DefaultStartsPerHour   = 10
	DefaultConfirmsPerHour = 30

	maxPending = 10000
)

var (
	// ErrClosed: Twilio is not configured, so nobody can register.
	ErrClosed = errors.New("registration closed")
	// ErrGone: the registration is unknown, expired or used up.
	ErrGone = errors.New("this registration has expired; start again")
	// ErrEmailTaken: the email belongs to another person.
	ErrEmailTaken = errors.New("that email is already registered")
	// ErrFull: the person already has MaxDevices devices.
	ErrFull = errors.New("This licence already has 3 devices. Remove one first.")
	// ErrDeviceTaken: the device key is on another person's licence.
	ErrDeviceTaken = errors.New("this device already belongs to another licence")
	// ErrBusy: too many registrations are waiting.
	ErrBusy = errors.New("registration is busy; try again in a few minutes")
	// ErrUpstream: Twilio could not be asked.
	ErrUpstream = errors.New("the verification service could not be reached; try again")
)

// InvalidError says in one line what is wrong with the input.
type InvalidError struct{ Msg string }

func (e *InvalidError) Error() string { return e.Msg }

// WrongCodeError: a code was not right. TriesLeft more wrong confirms are
// allowed.
type WrongCodeError struct{ TriesLeft int }

func (e *WrongCodeError) Error() string { return "that code is not right" }

// Result is what a confirmed registration answers.
type Result struct {
	PersonID string   `json:"personId"`
	Devices  []Device `json:"devices"`
	Issued   bool     `json:"issued"`
}

// PersonView is what GET /api/register/person answers for a known key.
type PersonView struct {
	PersonID   string   `json:"personId"`
	Keys       []string `json:"keys"`
	DailyLimit int      `json:"dailyLimit"`
}

// Option configures Open.
type Option func(*Service)

// WithVerifier opens registration: without one every start and confirm is
// ErrClosed.
func WithVerifier(v Verifier) Option { return func(s *Service) { s.verifier = v } }

// WithClock sets the clock, for tests.
func WithClock(now func() time.Time) Option { return func(s *Service) { s.now = now } }

// WithLimits sets the per-IP starts and confirms an hour; a value under 1
// keeps the default.
func WithLimits(startsPerHour, confirmsPerHour int) Option {
	return func(s *Service) {
		if startsPerHour > 0 {
			s.starts.limit = startsPerHour
		}
		if confirmsPerHour > 0 {
			s.confirms.limit = confirmsPerHour
		}
	}
}

// Service is registration: pending registrations in memory, people on disk.
// Safe for concurrent use.
type Service struct {
	verifier Verifier
	now      func() time.Time
	key      []byte

	starts, confirms *limiter

	mu      sync.Mutex // guards pending and people
	pending map[string]*pending
	people  *people
}

// pending is one registration waiting for its codes. Its fields are guarded
// by mu, except expires, which is set once.
type pending struct {
	mu      sync.Mutex
	email   string // normalised; in memory only
	phone   string // E.164; in memory only
	key     string
	expires time.Time

	emailOK, phoneOK bool
	tries            int
	dead             bool
}

// Open loads the people and the fingerprint key (made the first time) under
// dir.
func Open(dir string, opts ...Option) (*Service, error) {
	s := &Service{
		now:      time.Now,
		starts:   newLimiter(DefaultStartsPerHour),
		confirms: newLimiter(DefaultConfirmsPerHour),
		pending:  map[string]*pending{},
	}
	for _, opt := range opts {
		opt(s)
	}
	var err error
	if s.key, err = auth.LoadOrCreateKey(dir, KeyFile); err != nil {
		return nil, fmt.Errorf("loading the registration key: %w", err)
	}
	if s.people, err = openPeople(dir); err != nil {
		return nil, err
	}
	return s, nil
}

// Open reports whether registration is open: Twilio is configured.
func (s *Service) Open() bool { return s.verifier != nil }

// AllowStart and AllowConfirm count one request from ip against its hourly
// limit and say whether it may go on.
func (s *Service) AllowStart(ip string) bool   { return s.starts.allow(ip, s.now()) }
func (s *Service) AllowConfirm(ip string) bool { return s.confirms.allow(ip, s.now()) }

var phonePattern = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)

func normaliseEmail(raw string) (string, error) {
	email := strings.ToLower(strings.TrimSpace(raw))
	addr, err := mail.ParseAddress(email)
	if err != nil || addr.Address != email || len(email) > 254 || !strings.Contains(email[strings.LastIndex(email, "@"):], ".") {
		return "", &InvalidError{"that does not look like an email address"}
	}
	return email, nil
}

func normalisePhone(raw string) (string, error) {
	phone := strings.NewReplacer(" ", "", "-", "", "(", "", ")", "", ".", "").Replace(strings.TrimSpace(raw))
	if !phonePattern.MatchString(phone) {
		return "", &InvalidError{"type the phone with its country code, like +14155550101"}
	}
	return phone, nil
}

func normaliseKey(raw string) (string, error) {
	key := strings.ToLower(strings.TrimSpace(raw))
	b, err := hex.DecodeString(key)
	if err != nil || len(b) != 33 || (b[0] != 2 && b[0] != 3) {
		return "", &InvalidError{"deviceKey must be a compressed public key: 66 hex characters starting 02 or 03"}
	}
	return key, nil
}

// fpEmail and fpPhone are the keyed fingerprints the store holds in place of
// an address: HMAC-SHA256 of the lower-cased, trimmed email or the E.164 phone.
func (s *Service) fpEmail(email string) string {
	return s.mac(strings.ToLower(strings.TrimSpace(email)))
}
func (s *Service) fpPhone(phone string) string { return s.mac(phone) }

func (s *Service) mac(text string) string {
	m := hmac.New(sha256.New, s.key)
	m.Write([]byte(text))
	return hex.EncodeToString(m.Sum(nil))
}

// Start validates the input, has Twilio send a code to the email and one to
// the phone, and answers the registration id Confirm takes.
func (s *Service) Start(ctx context.Context, email, phone, deviceKey string) (string, error) {
	if !s.Open() {
		return "", ErrClosed
	}
	email, err := normaliseEmail(email)
	if err != nil {
		return "", err
	}
	if phone, err = normalisePhone(phone); err != nil {
		return "", err
	}
	if deviceKey, err = normaliseKey(deviceKey); err != nil {
		return "", err
	}
	id, err := randomID()
	if err != nil {
		return "", err
	}

	s.mu.Lock()
	now := s.now()
	for k, p := range s.pending {
		if now.After(p.expires) {
			delete(s.pending, k)
		}
	}
	if len(s.pending) >= maxPending {
		s.mu.Unlock()
		return "", ErrBusy
	}
	s.mu.Unlock()

	if err := s.verifier.Start(ctx, ChannelEmail, email); err != nil {
		return "", s.upstream(err)
	}
	if err := s.verifier.Start(ctx, ChannelSMS, phone); err != nil {
		return "", s.upstream(err)
	}
	s.mu.Lock()
	s.pending[id] = &pending{email: email, phone: phone, key: deviceKey, expires: now.Add(TTL)}
	s.mu.Unlock()
	return id, nil
}

// upstream logs a Twilio failure (its errors never carry an address) and
// answers what the caller may see.
func (s *Service) upstream(err error) error {
	if errors.Is(err, ErrRejected) {
		return err
	}
	log.Printf("register: %v", err)
	return ErrUpstream
}

// Confirm checks the two codes and, when both are right, finds or makes the
// person and adds the device. A code already approved need not be sent
// again (Twilio will not check an approved verification twice). Any final
// answer, a refusal as well as a success, ends the registration. userAgent
// names the device when it is new.
func (s *Service) Confirm(ctx context.Context, id, emailCode, phoneCode, userAgent string) (Result, error) {
	if !s.Open() {
		return Result{}, ErrClosed
	}
	s.mu.Lock()
	p := s.pending[id]
	if p != nil && s.now().After(p.expires) {
		delete(s.pending, id)
		p = nil
	}
	s.mu.Unlock()
	if p == nil {
		return Result{}, ErrGone
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	if p.dead {
		return Result{}, ErrGone
	}
	wrong := false
	for _, c := range []struct {
		ok      *bool
		channel Channel
		to      string
		code    string
	}{
		{&p.emailOK, ChannelEmail, p.email, strings.TrimSpace(emailCode)},
		{&p.phoneOK, ChannelSMS, p.phone, strings.TrimSpace(phoneCode)},
	} {
		if *c.ok {
			continue
		}
		if c.code == "" {
			wrong = true
			continue
		}
		approved, err := s.verifier.Check(ctx, c.channel, c.to, c.code)
		if err != nil {
			return Result{}, s.upstream(err)
		}
		if approved {
			*c.ok = true
		} else {
			wrong = true
		}
	}
	if wrong {
		p.tries++
		if p.tries >= MaxTries {
			s.end(id, p)
		}
		return Result{}, &WrongCodeError{TriesLeft: MaxTries - p.tries}
	}

	result, err := s.join(p, userAgent)
	s.end(id, p)
	return result, err
}

func (s *Service) end(id string, p *pending) {
	p.dead = true
	s.mu.Lock()
	delete(s.pending, id)
	s.mu.Unlock()
}

// join finds or makes the person the proven email and phone name and adds
// p's device to them.
func (s *Service) join(p *pending, userAgent string) (Result, error) {
	fpE, fpP := s.fpEmail(p.email), s.fpPhone(p.phone)

	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	byP, byE := s.people.byFpP[fpP], s.people.byFpE[fpE]
	var next *person
	switch {
	case byP != nil && byE != nil && byP != byE, byP == nil && byE != nil:
		return Result{}, ErrEmailTaken
	case byP != nil:
		next = byP.clone()
	default:
		id, err := randomID()
		if err != nil {
			return Result{}, err
		}
		next = &person{PersonID: id, FpE: fpE, FpP: fpP, DailyLimit: DefaultDailyLimit, CreatedAt: now}
	}
	if owner := s.people.byKey[p.key]; owner != nil && owner.PersonID != next.PersonID {
		return Result{}, ErrDeviceTaken
	}
	if !next.hasEmail(fpE) {
		next.MoreFpE = append(next.MoreFpE, fpE)
	}
	known := false
	for _, d := range next.Devices {
		known = known || d.Key == p.key
	}
	if !known {
		if len(next.Devices) >= MaxDevices {
			return Result{}, ErrFull
		}
		next.Devices = append(next.Devices, Device{Key: p.key, Name: deviceName(userAgent, len(next.Devices)+1), AddedAt: now})
	}
	if err := s.people.put(next); err != nil {
		return Result{}, err
	}
	return Result{PersonID: next.PersonID, Devices: append([]Device(nil), next.Devices...)}, nil
}

// Person is the person whose licence holds key, for the mill: ok is false for
// a key no one registered.
func (s *Service) Person(key string) (PersonView, bool) {
	key, err := normaliseKey(key)
	if err != nil {
		return PersonView{}, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.people.byKey[key]
	if p == nil {
		return PersonView{}, false
	}
	view := PersonView{PersonID: p.PersonID, DailyLimit: p.DailyLimit, Keys: make([]string, len(p.Devices))}
	for i, d := range p.Devices {
		view.Keys[i] = d.Key
	}
	return view, true
}

// deviceName names a new device from its user agent, or "Device n".
func deviceName(userAgent string, n int) string {
	switch ua := strings.ToLower(userAgent); {
	case strings.Contains(ua, "android"):
		return "Android phone"
	case strings.Contains(ua, "iphone"):
		return "iPhone"
	case strings.Contains(ua, "ipad"):
		return "iPad"
	case strings.Contains(ua, "windows"):
		return "Windows computer"
	case strings.Contains(ua, "cros"):
		return "Chromebook"
	case strings.Contains(ua, "macintosh"):
		return "Mac"
	case strings.Contains(ua, "linux"):
		return "Linux computer"
	}
	return fmt.Sprintf("Device %d", n)
}

// limiter allows limit requests an hour per key (an IP), by a sliding
// window.
type limiter struct {
	limit int

	mu   sync.Mutex
	seen map[string][]time.Time
}

func newLimiter(limit int) *limiter { return &limiter{limit: limit, seen: map[string][]time.Time{}} }

func (l *limiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.seen) > 4096 {
		for k, stamps := range l.seen {
			if now.Sub(stamps[len(stamps)-1]) >= time.Hour {
				delete(l.seen, k)
			}
		}
	}
	kept := l.seen[key][:0]
	for _, at := range l.seen[key] {
		if now.Sub(at) < time.Hour {
			kept = append(kept, at)
		}
	}
	if len(kept) >= l.limit {
		l.seen[key] = kept
		return false
	}
	l.seen[key] = append(kept, now)
	return true
}
