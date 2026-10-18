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

	// Every start has Twilio send a code to an email and one to a phone,
	// and each SMS costs money, so an IP's limit is not enough: callers on
	// many IPs could have codes sent to one paid number many times, or to many
	// (SMS pumping). DefaultDestinationStartsPerHour and
	// DefaultDestinationStartsPerDay are the starts one email, and one phone,
	// may have; DefaultSendsPerHour is the starts all callers together may
	// have an hour (POSTERN_REGISTER_SENDS_PER_HOUR).
	DefaultDestinationStartsPerHour = 3
	DefaultDestinationStartsPerDay  = 10
	DefaultSendsPerHour             = 30

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
	// ErrTooMany: the email or the phone has had all the codes it may for now.
	ErrTooMany = errors.New("too many codes have gone to that email or phone; wait an hour and try again")
	// ErrSendCap: all callers together have had all the codes they may this
	// hour.
	ErrSendCap = errors.New("registration is busy; try again in an hour")
)

// InvalidError says in one line what is wrong with the input.
type InvalidError struct{ Msg string }

func (e *InvalidError) Error() string { return e.Msg }

// WrongCodeError: a code was not right. TriesLeft more wrong confirms are
// allowed.
type WrongCodeError struct{ TriesLeft int }

func (e *WrongCodeError) Error() string { return "that code is not right" }

// Result is what a confirmed registration answers. Issued says the device
// holds a licence the site issuer minted (its txid is the device's
// licenceTxid).
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

// WithSendLimits sets the starts one email or one phone may have an hour and
// a day, and the starts all callers together may have an hour; a value under
// 1 keeps the default.
func WithSendLimits(perDestinationHour, perDestinationDay, perHour int) Option {
	return func(s *Service) {
		if perDestinationHour > 0 {
			s.destHour.limit = perDestinationHour
		}
		if perDestinationDay > 0 {
			s.destDay.limit = perDestinationDay
		}
		if perHour > 0 {
			s.sends.limit = perHour
		}
	}
}

// Service is registration: pending registrations in memory, people on disk.
// Safe for concurrent use.
type Service struct {
	verifier Verifier
	issuer   LicenceIssuer
	now      func() time.Time
	key      []byte

	// changing serialises what changes a person and may touch the chain
	// (a join that issues, a removal that revokes), so a person cannot change
	// between the plan and the write while mu is free for lookups.
	changing sync.Mutex

	starts, confirms *limiter

	mu      sync.Mutex // guards pending, people, the send limits and capped
	pending map[string]*pending
	people  *people

	// The send limits, by keyed fingerprint ("e:" or "p:" and the HMAC) and
	// in all ("").
	destHour, destDay, sends *limiter
	capped                   bool // the send cap has refused, and said so, since it last allowed
	maxPending               int
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

		destHour:   newLimiter(DefaultDestinationStartsPerHour),
		destDay:    newWindowLimiter(DefaultDestinationStartsPerDay, 24*time.Hour),
		sends:      newLimiter(DefaultSendsPerHour),
		maxPending: maxPending,
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

// SendsPerHour is the starts all callers together may have an hour.
func (s *Service) SendsPerHour() int { return s.sends.limit }

// Open reports whether registration is open: Twilio is configured.
func (s *Service) Open() bool { return s.verifier != nil }

// Issuing reports whether a confirmed device is licensed here: the site
// issuer key is set. Without it start and confirm answer ErrByHand.
func (s *Service) Issuing() bool { return s.issuer != nil }

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
// the phone, and answers the registration id Confirm takes. It refuses
// before anything is sent when the email or the phone has had its starts
// (ErrTooMany), all callers together have (ErrSendCap), or too many
// registrations wait (ErrBusy).
func (s *Service) Start(ctx context.Context, email, phone, deviceKey string) (string, error) {
	if !s.Open() {
		return "", ErrClosed
	}
	if !s.Issuing() {
		return "", ErrByHand
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

	destinations := []string{"e:" + s.fpEmail(email), "p:" + s.fpPhone(phone)}

	// The place is checked for and taken under one lock, so concurrent starts
	// cannot overshoot maxPending or the send limits; no one knows id until
	// Start answers it, so the registration cannot be confirmed before its
	// codes are sent.
	s.mu.Lock()
	now := s.now()
	for k, p := range s.pending {
		if now.After(p.expires) {
			delete(s.pending, k)
		}
	}
	if err := s.admit(destinations, now); err != nil {
		s.mu.Unlock()
		return "", err
	}
	s.pending[id] = &pending{email: email, phone: phone, key: deviceKey, expires: now.Add(TTL)}
	s.mu.Unlock()

	err = s.verifier.Start(ctx, ChannelEmail, email)
	if err == nil {
		err = s.verifier.Start(ctx, ChannelSMS, phone)
	}
	if err != nil {
		s.mu.Lock()
		delete(s.pending, id)
		s.mu.Unlock()
		return "", s.upstream(err)
	}
	return id, nil
}

// admit takes a place for one more pending registration and counts one start
// to each of destinations, and one in all, against the send limits: all of
// them, or, with the reason, none. Called with mu held. A start Twilio then
// fails still counts, since Twilio may have sent its code.
func (s *Service) admit(destinations []string, now time.Time) error {
	if len(s.pending) >= s.maxPending {
		return ErrBusy
	}
	for _, d := range destinations {
		if !s.destHour.room(d, now) || !s.destDay.room(d, now) {
			return ErrTooMany
		}
	}
	if !s.sends.room("", now) {
		if !s.capped {
			// Said once, until the cap allows again, and with no address.
			log.Printf("register: the send cap of %d starts an hour (POSTERN_REGISTER_SENDS_PER_HOUR) is reached; starts are refused until the hour frees one", s.sends.limit)
			s.capped = true
		}
		return ErrSendCap
	}
	s.capped = false
	for _, d := range destinations {
		s.destHour.take(d, now)
		s.destDay.take(d, now)
	}
	s.sends.take("", now)
	return nil
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
// person, has the site issuer license the device and adds it. A code already
// approved need not be sent again (Twilio will not check an approved
// verification twice). Any final answer, a refusal as well as a success,
// ends the registration; a licence that could not be issued (ErrIssue) is
// not final, so the same codes may confirm again. userAgent names the device
// when it is new.
func (s *Service) Confirm(ctx context.Context, id, emailCode, phoneCode, userAgent string) (Result, error) {
	if !s.Open() {
		return Result{}, ErrClosed
	}
	if !s.Issuing() {
		return Result{}, ErrByHand
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
	if !errors.Is(err, ErrIssue) {
		s.end(id, p)
	}
	return result, err
}

func (s *Service) end(id string, p *pending) {
	p.dead = true
	s.mu.Lock()
	delete(s.pending, id)
	s.mu.Unlock()
}

// join finds or makes the person the proven email and phone name, has the
// site issuer license p's device unless it holds a licence already, and
// stores the person with the device and its licence's txid. Nothing is
// stored when the licence cannot be issued.
func (s *Service) join(p *pending, userAgent string) (Result, error) {
	s.changing.Lock()
	defer s.changing.Unlock()
	next, err := s.plan(p, userAgent)
	if err != nil {
		return Result{}, err
	}
	at := next.device(p.key)
	if next.Devices[at].LicenceTxid == "" {
		txid, err := s.issuer.Issue(p.key)
		if err != nil {
			log.Printf("register: issuing a licence: %v", err)
			return Result{}, ErrIssue
		}
		log.Printf("register: issued licence %s:0", txid)
		next.Devices[at].LicenceTxid = txid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.people.put(next); err != nil {
		log.Printf("register: licence %s:0 was issued and not stored: %v", next.Devices[at].LicenceTxid, err)
		return Result{}, err
	}
	return Result{PersonID: next.PersonID, Devices: append([]Device(nil), next.Devices...), Issued: true}, nil
}

// plan is the person p joins, a clone holding p's device (new, or as it was).
func (s *Service) plan(p *pending, userAgent string) (*person, error) {
	fpE, fpP := s.fpEmail(p.email), s.fpPhone(p.phone)

	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	byP, byE := s.people.byFpP[fpP], s.people.byFpE[fpE]
	var next *person
	switch {
	case byP != nil && byE != nil && byP != byE, byP == nil && byE != nil:
		return nil, ErrEmailTaken
	case byP != nil:
		next = byP.clone()
	default:
		id, err := randomID()
		if err != nil {
			return nil, err
		}
		next = &person{PersonID: id, FpE: fpE, FpP: fpP, DailyLimit: DefaultDailyLimit, CreatedAt: now}
	}
	if owner := s.people.byKey[p.key]; owner != nil && owner.PersonID != next.PersonID {
		return nil, ErrDeviceTaken
	}
	if !next.hasEmail(fpE) {
		next.MoreFpE = append(next.MoreFpE, fpE)
	}
	if next.device(p.key) < 0 {
		if len(next.Devices) >= MaxDevices {
			return nil, ErrFull
		}
		next.Devices = append(next.Devices, Device{Key: p.key, Name: deviceName(userAgent, len(next.Devices)+1), AddedAt: now})
	}
	return next, nil
}

// RemoveDevice takes deviceKey off personID's licence at the word of
// signerKey, which must be a device on that licence (itself included): the
// site issuer revokes the device's licence, and the device is dropped, which
// frees its slot. A device the site issuer never licensed is dropped only.
// Nothing changes when the revoke fails (ErrRevoke).
func (s *Service) RemoveDevice(personID, signerKey, deviceKey string) (Result, error) {
	signer, err := normaliseKey(signerKey)
	if err != nil {
		return Result{}, ErrNotYours
	}
	if deviceKey, err = normaliseKey(deviceKey); err != nil {
		return Result{}, err
	}
	s.changing.Lock()
	defer s.changing.Unlock()

	s.mu.Lock()
	owner := s.people.byKey[signer]
	if owner == nil || owner.PersonID != personID {
		s.mu.Unlock()
		return Result{}, ErrNotYours
	}
	next := owner.clone()
	s.mu.Unlock()
	at := next.device(deviceKey)
	if at < 0 {
		return Result{}, ErrNoDevice
	}
	if txid := next.Devices[at].LicenceTxid; txid != "" {
		if !s.Issuing() {
			return Result{}, ErrByHand
		}
		revoke, err := s.issuer.Revoke(txid + ":0")
		if err != nil {
			log.Printf("register: revoking licence %s:0: %v", txid, err)
			return Result{}, ErrRevoke
		}
		log.Printf("register: revoked licence %s:0 in %s", txid, revoke)
	}
	next.Devices = append(next.Devices[:at], next.Devices[at+1:]...)
	s.mu.Lock()
	defer s.mu.Unlock()
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
	return p.view(), true
}

// PersonForDevice is Person asked by one of that person's own devices:
// signerKey must be a device on the licence that holds key (key itself
// included). Anything else, a stranger, another person's device or a key no
// one registered, is ErrNotYours, so a refusal says nothing about key.
func (s *Service) PersonForDevice(signerKey, key string) (PersonView, error) {
	signer, err := normaliseKey(signerKey)
	if err != nil {
		return PersonView{}, ErrNotYours
	}
	if key, err = normaliseKey(key); err != nil {
		return PersonView{}, ErrNotYours
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	owner := s.people.byKey[signer]
	if owner == nil || s.people.byKey[key] != owner {
		return PersonView{}, ErrNotYours
	}
	return owner.view(), nil
}

func (p *person) view() PersonView {
	view := PersonView{PersonID: p.PersonID, DailyLimit: p.DailyLimit, Keys: make([]string, len(p.Devices))}
	for i, d := range p.Devices {
		view.Keys[i] = d.Key
	}
	return view
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

// limiter allows limit requests a window (an hour, unless said) per key (an
// IP, or a destination's fingerprint), by a sliding window.
type limiter struct {
	limit  int
	window time.Duration

	mu   sync.Mutex
	seen map[string][]time.Time
}

func newLimiter(limit int) *limiter { return newWindowLimiter(limit, time.Hour) }

func newWindowLimiter(limit int, window time.Duration) *limiter {
	return &limiter{limit: limit, window: window, seen: map[string][]time.Time{}}
}

// allow counts one request by key and says whether it is within the limit; a
// request over it is not counted.
func (l *limiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	kept := l.recent(key, now)
	if len(kept) >= l.limit {
		return false
	}
	l.seen[key] = append(kept, now)
	return true
}

// room says whether key may make one more request, counting nothing.
func (l *limiter) room(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.recent(key, now)) < l.limit
}

// take counts one request by key, whatever the limit.
func (l *limiter) take(key string, now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.seen[key] = append(l.recent(key, now), now)
}

// recent drops key's requests older than the window and answers those left;
// a key with none is forgotten. Called with mu held.
func (l *limiter) recent(key string, now time.Time) []time.Time {
	if len(l.seen) > 4096 {
		for k, stamps := range l.seen {
			if len(stamps) == 0 || now.Sub(stamps[len(stamps)-1]) >= l.window {
				delete(l.seen, k)
			}
		}
	}
	kept := l.seen[key][:0]
	for _, at := range l.seen[key] {
		if now.Sub(at) < l.window {
			kept = append(kept, at)
		}
	}
	if len(kept) == 0 {
		delete(l.seen, key)
	} else {
		l.seen[key] = kept
	}
	return kept
}
