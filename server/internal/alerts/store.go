// Package alerts keeps a family's alert feed (docs/protocol.md §26): the
// parsed facts of the mails its alert address received, never a mail body.
// Each family has one address token; an alert is kept until a phone claims it
// or it is 30 days old.
package alerts

import (
	"crypto/rand"
	"encoding/base32"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
	"unicode/utf8"
)

const fileName = "alerts.json"

// Kinds of alert.
const (
	KindCharge         = "charge"
	KindForwardConfirm = "forward-confirm"
	KindAmazon         = "amazon"
	KindUnread         = "unread"
)

// Keep is how long an alert is kept before the sweep drops it.
const Keep = 30 * 24 * time.Hour

// MaxFieldRunes caps every text field of an alert: parsed facts are short,
// and a field this long is a mail body in the wrong place.
const MaxFieldRunes = 200

// TokenLength is the length of a family's address token.
const TokenLength = 12

// Alert is one parsed fact (docs/protocol.md §26): what the family's phones
// list. Only the fields its kind has are set.
type Alert struct {
	ID       string `json:"id"`
	Seq      uint64 `json:"seq"`
	Kind     string `json:"kind"`
	Amount   string `json:"amount,omitempty"`
	Merchant string `json:"merchant,omitempty"`
	Last4    string `json:"last4,omitempty"`
	When     string `json:"when,omitempty"`
	Subject  string `json:"subject,omitempty"`
	Code     string `json:"code,omitempty"`
}

var (
	// ErrUnknownToken: no family has this address token.
	ErrUnknownToken = errors.New("alerts: no family has this address")
)

// InvalidError is an alert that is not parsed facts.
type InvalidError struct{ Msg string }

func (e *InvalidError) Error() string { return e.Msg }

type stored struct {
	Alert
	Family     string    `json:"family"`
	ReceivedAt time.Time `json:"receivedAt"`
}

type fileShape struct {
	NextSeq   uint64            `json:"nextSeq"`
	Addresses map[string]string `json:"addresses"` // family -> token
	Alerts    []stored          `json:"alerts"`
}

// Store is the durable set of addresses and alerts, one JSON file in
// POSTERN_DATA. Safe for concurrent use.
type Store struct {
	mu     sync.Mutex
	path   string
	now    func() time.Time
	data   fileShape
	tokens map[string]string // token -> family
}

// Option configures OpenStore.
type Option func(*Store)

// WithClock sets the store's clock (default time.Now).
func WithClock(now func() time.Time) Option { return func(s *Store) { s.now = now } }

// OpenStore loads dir/alerts.json, starting empty if it does not exist.
func OpenStore(dir string, opts ...Option) (*Store, error) {
	s := &Store{path: filepath.Join(dir, fileName), now: time.Now, tokens: map[string]string{}}
	for _, opt := range opts {
		opt(s)
	}
	raw, err := os.ReadFile(s.path)
	switch {
	case err == nil:
		if err := json.Unmarshal(raw, &s.data); err != nil {
			return nil, fmt.Errorf("parsing %s: %w", s.path, err)
		}
	case !os.IsNotExist(err):
		return nil, fmt.Errorf("reading %s: %w", s.path, err)
	}
	if s.data.Addresses == nil {
		s.data.Addresses = map[string]string{}
	}
	for family, token := range s.data.Addresses {
		s.tokens[token] = family
	}
	return s, nil
}

var tokenEncoding = base32.NewEncoding("abcdefghijklmnopqrstuvwxyz234567").WithPadding(base32.NoPadding)

func newToken() (string, error) {
	raw := make([]byte, 8)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("making an address token: %w", err)
	}
	return tokenEncoding.EncodeToString(raw)[:TokenLength], nil
}

func newID() (string, error) {
	raw := make([]byte, 8)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("making an alert id: %w", err)
	}
	return hex.EncodeToString(raw), nil
}

// Address is the family's address token, made on the first ask and the same
// ever after.
func (s *Store) Address(family string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if token, ok := s.data.Addresses[family]; ok {
		return token, nil
	}
	for {
		token, err := newToken()
		if err != nil {
			return "", err
		}
		if _, taken := s.tokens[token]; taken {
			continue
		}
		s.data.Addresses[family] = token
		s.tokens[token] = family
		if err := s.save(); err != nil {
			delete(s.data.Addresses, family)
			delete(s.tokens, token)
			return "", err
		}
		return token, nil
	}
}

// FamilyOf is the family that owns the address token.
func (s *Store) FamilyOf(token string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	family, ok := s.tokens[token]
	return family, ok
}

// Add keeps a parsed alert for the family that owns token, and answers it
// (with its id and seq) and the family. An alert that is not parsed facts is
// an *InvalidError; an unknown token is ErrUnknownToken.
func (s *Store) Add(token string, a Alert) (Alert, string, error) {
	if err := check(a); err != nil {
		return Alert{}, "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	family, ok := s.tokens[token]
	if !ok {
		return Alert{}, "", ErrUnknownToken
	}
	id, err := newID()
	if err != nil {
		return Alert{}, "", err
	}
	s.data.NextSeq++
	a.ID, a.Seq = id, s.data.NextSeq
	s.data.Alerts = append(s.data.Alerts, stored{Alert: a, Family: family, ReceivedAt: s.now()})
	if err := s.save(); err != nil {
		s.data.Alerts = s.data.Alerts[:len(s.data.Alerts)-1]
		return Alert{}, "", err
	}
	return a, family, nil
}

// check is the privacy rule: only the kinds there are, only short facts.
func check(a Alert) error {
	switch a.Kind {
	case KindCharge, KindForwardConfirm, KindAmazon, KindUnread:
	default:
		return &InvalidError{Msg: fmt.Sprintf("kind must be charge, forward-confirm, amazon or unread, not %q", a.Kind)}
	}
	for name, value := range map[string]string{"amount": a.Amount, "merchant": a.Merchant, "subject": a.Subject, "code": a.Code} {
		if utf8.RuneCountInString(value) > MaxFieldRunes {
			return &InvalidError{Msg: name + " is longer than " + fmt.Sprint(MaxFieldRunes) + " characters; an alert holds parsed facts, never a mail body"}
		}
	}
	if len(a.Last4) > 4 {
		return &InvalidError{Msg: "last4 is at most 4 characters"}
	}
	if a.When != "" {
		if _, err := time.Parse(time.RFC3339, a.When); err != nil {
			return &InvalidError{Msg: "when must be an RFC 3339 time"}
		}
	}
	return nil
}

// List is the family's alerts with a seq above since, oldest first.
func (s *Store) List(family string, since uint64) []Alert {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []Alert
	for _, a := range s.data.Alerts {
		if a.Family == family && a.Seq > since {
			out = append(out, a.Alert)
		}
	}
	return out
}

// Claim deletes the family's alert id, for every phone of the family, and
// reports whether there was one. Another family's alert is not found.
func (s *Store) Claim(family, id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, a := range s.data.Alerts {
		if a.Family == family && a.ID == id {
			kept := append(append([]stored(nil), s.data.Alerts[:i]...), s.data.Alerts[i+1:]...)
			previous := s.data.Alerts
			s.data.Alerts = kept
			if err := s.save(); err != nil {
				s.data.Alerts = previous
				return false, err
			}
			return true, nil
		}
	}
	return false, nil
}

// Sweep drops every alert older than Keep and answers how many.
func (s *Store) Sweep() (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cutoff := s.now().Add(-Keep)
	var kept []stored
	for _, a := range s.data.Alerts {
		if !a.ReceivedAt.Before(cutoff) {
			kept = append(kept, a)
		}
	}
	dropped := len(s.data.Alerts) - len(kept)
	if dropped == 0 {
		return 0, nil
	}
	previous := s.data.Alerts
	s.data.Alerts = kept
	if err := s.save(); err != nil {
		s.data.Alerts = previous
		return 0, err
	}
	return dropped, nil
}

// save writes the file atomically. Callers hold s.mu.
func (s *Store) save() error {
	raw, err := json.Marshal(s.data)
	if err != nil {
		return fmt.Errorf("marshaling alerts: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return fmt.Errorf("creating data directory: %w", err)
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return fmt.Errorf("writing %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, s.path); err != nil {
		return fmt.Errorf("replacing %s: %w", s.path, err)
	}
	return nil
}
