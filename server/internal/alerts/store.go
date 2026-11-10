// Package alerts keeps a family's alert feed (docs/protocol.md §26): the
// parsed facts of the mails its alert address received, never a mail body.
// Each family has one address token; an alert is kept until a phone claims it
// or it is 30 days old. A sermon-notes alert may carry its mail's notes PDF,
// kept as its bytes beside the feed (alert-notes/<id>.pdf) for as long as the
// alert is, and never read.
package alerts

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const fileName = "alerts.json"

// notesDirName is the directory beside alerts.json that holds the notes of
// sermon-notes alerts, one file per alert, named by its id.
const notesDirName = "alert-notes"

// MaxNotesBytes caps the notes PDF a sermon-notes alert may carry: 5 MiB. The
// receiver keeps no larger PDF, the inbound route takes no larger body (with
// the base64 JSON carries bytes in), and the receiver's own mail cap fits a
// mail carrying one.
const MaxNotesBytes = 5 << 20

// pdfMagic is how every PDF begins. It is the only thing of a PDF anything
// here looks at.
const pdfMagic = "%PDF-"

// Kinds of alert.
const (
	KindCharge         = "charge"
	KindForwardConfirm = "forward-confirm"
	KindAmazon         = "amazon"
	KindUnread         = "unread"
	KindZelleSent      = "zelle-sent"
	KindDeposit        = "deposit"
	KindSermonNotes    = "sermon-notes"
)

// Keep is how long an alert is kept before the sweep drops it.
const Keep = 30 * 24 * time.Hour

// MaxFieldRunes caps every text field of an alert: parsed facts are short,
// and a field this long is a mail body in the wrong place.
const MaxFieldRunes = 200

// MaxLinkRunes caps an alert's link: a real Gmail confirmation link is longer
// than a text field, but still a link and never a mail body.
const MaxLinkRunes = 500

// ConfirmHosts are the hosts a Gmail forwarding confirmation link is on, each
// exact: mail.google.com, mail-settings.google.com (Gmail's real mail of 2021,
// lkml.rescloud.iu.edu/2101.2/01750.html) and isolated.mail.google.com (of
// 2012, lists.ubuntu.com/archives/ubuntu-sn/2012-July/000010.html). No other
// host, google.com's own included, is ever kept.
var ConfirmHosts = []string{"mail.google.com", "mail-settings.google.com", "isolated.mail.google.com"}

// confirmLink is the only link an alert carries: the one that confirms Gmail's
// forwarding. The host is one of ConfirmHosts and the path exact, and nothing
// after the token but URL-safe characters (no query, no fragment, no
// userinfo, no port, no further path).
var confirmLink = regexp.MustCompile(`^https://(?:` + strings.Join(quoteAll(ConfirmHosts), "|") + `)/mail/vf-[A-Za-z0-9%._~+=-]+$`)

func quoteAll(hosts []string) []string {
	quoted := make([]string, len(hosts))
	for i, h := range hosts {
		quoted[i] = regexp.QuoteMeta(h)
	}
	return quoted
}

// IsConfirmLink reports whether s is whole of the form
// https://<one of ConfirmHosts>/mail/vf-..., within MaxLinkRunes.
func IsConfirmLink(s string) bool {
	return utf8.RuneCountInString(s) <= MaxLinkRunes && confirmLink.MatchString(s)
}

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
	Link     string `json:"link,omitempty"`
	Memo     string `json:"memo,omitempty"`
	// Title and Reference are a sermon-notes alert's: the sermon's title and
	// the passage it is on, from the mail's subject.
	Title     string `json:"title,omitempty"`
	Reference string `json:"reference,omitempty"`
	// Notes is the base64 of a sermon-notes mail's notes PDF, as the receiver
	// posts it. The store keeps the bytes in a file of their own and never in
	// the feed: an alert it answers has no Notes, only NotesSHA256 (hex) and
	// NotesSize (bytes), which the store gives and a post may not.
	Notes       string `json:"notes,omitempty"`
	NotesSHA256 string `json:"notes_sha256,omitempty"`
	NotesSize   int    `json:"notes_size,omitempty"`
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
	mu       sync.Mutex
	path     string
	notesDir string
	now      func() time.Time
	data     fileShape
	tokens   map[string]string // token -> family
}

// Option configures OpenStore.
type Option func(*Store)

// WithClock sets the store's clock (default time.Now).
func WithClock(now func() time.Time) Option { return func(s *Store) { s.now = now } }

// OpenStore loads dir/alerts.json, starting empty if it does not exist.
func OpenStore(dir string, opts ...Option) (*Store, error) {
	s := &Store{path: filepath.Join(dir, fileName), notesDir: filepath.Join(dir, notesDirName), now: time.Now, tokens: map[string]string{}}
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
// (with its id and seq) and the family. A sermon-notes alert's notes are
// written to their own file and answered as their sha256 and size. An alert
// that is not parsed facts is an *InvalidError; an unknown token is
// ErrUnknownToken.
func (s *Store) Add(token string, a Alert) (Alert, string, error) {
	if err := check(a); err != nil {
		return Alert{}, "", err
	}
	notes, err := notesOf(a)
	if err != nil {
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
	a.Notes = ""
	if notes != nil {
		if err := s.writeNotes(id, notes); err != nil {
			return Alert{}, "", err
		}
		sum := sha256.Sum256(notes)
		a.NotesSHA256, a.NotesSize = hex.EncodeToString(sum[:]), len(notes)
	}
	s.data.NextSeq++
	a.ID, a.Seq = id, s.data.NextSeq
	s.data.Alerts = append(s.data.Alerts, stored{Alert: a, Family: family, ReceivedAt: s.now()})
	if err := s.save(); err != nil {
		s.data.Alerts = s.data.Alerts[:len(s.data.Alerts)-1]
		s.removeNotes(id)
		return Alert{}, "", err
	}
	return a, family, nil
}

// notesOf is the PDF a sermon-notes alert carries, or nil for none: base64 of
// bytes that begin '%PDF-', at most MaxNotesBytes, on a sermon-notes alert
// only. The sha256 and size are the store's to give, never a post's.
func notesOf(a Alert) ([]byte, error) {
	if a.NotesSHA256 != "" || a.NotesSize != 0 {
		return nil, &InvalidError{Msg: "notes_sha256 and notes_size are the backend's to give; post the notes themselves"}
	}
	if a.Notes == "" {
		return nil, nil
	}
	if a.Kind != KindSermonNotes {
		return nil, &InvalidError{Msg: "only a sermon-notes alert carries notes"}
	}
	if len(a.Notes) > base64.StdEncoding.EncodedLen(MaxNotesBytes) {
		return nil, &InvalidError{Msg: fmt.Sprintf("notes are at most %d bytes", MaxNotesBytes)}
	}
	notes, err := base64.StdEncoding.DecodeString(a.Notes)
	switch {
	case err != nil:
		return nil, &InvalidError{Msg: "notes must be base64"}
	case len(notes) > MaxNotesBytes:
		return nil, &InvalidError{Msg: fmt.Sprintf("notes are at most %d bytes", MaxNotesBytes)}
	case !bytes.HasPrefix(notes, []byte(pdfMagic)):
		return nil, &InvalidError{Msg: "notes must be a PDF, beginning " + pdfMagic}
	}
	return notes, nil
}

// notesPath is where the alert id's notes are kept.
func (s *Store) notesPath(id string) string { return filepath.Join(s.notesDir, id+".pdf") }

// writeNotes writes the alert id's notes atomically, readable by the backend
// alone. Callers hold s.mu.
func (s *Store) writeNotes(id string, notes []byte) error {
	if err := os.MkdirAll(s.notesDir, 0o700); err != nil {
		return fmt.Errorf("creating the notes directory: %w", err)
	}
	tmp := s.notesPath(id) + ".tmp"
	if err := os.WriteFile(tmp, notes, 0o600); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("writing an alert's notes: %w", err)
	}
	if err := os.Rename(tmp, s.notesPath(id)); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("keeping an alert's notes: %w", err)
	}
	return nil
}

// removeNotes deletes the alert id's notes, if it has any. A file left by a
// failure here is one no alert names, which the next Sweep removes.
func (s *Store) removeNotes(id string) { _ = os.Remove(s.notesPath(id)) }

// Notes is the notes PDF of the family's alert id, and whether there is one:
// another family's alert, an unknown id and an alert with no notes have none.
func (s *Store) Notes(family, id string) ([]byte, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, a := range s.data.Alerts {
		if a.Family == family && a.ID == id {
			if a.NotesSize == 0 {
				return nil, false, nil
			}
			notes, err := os.ReadFile(s.notesPath(id))
			if os.IsNotExist(err) {
				return nil, false, nil
			}
			if err != nil {
				return nil, false, fmt.Errorf("reading an alert's notes: %w", err)
			}
			return notes, true, nil
		}
	}
	return nil, false, nil
}

// check is the privacy rule: only the kinds there are, only short facts.
func check(a Alert) error {
	switch a.Kind {
	case KindCharge, KindForwardConfirm, KindAmazon, KindUnread, KindZelleSent, KindDeposit, KindSermonNotes:
	default:
		return &InvalidError{Msg: fmt.Sprintf("kind must be charge, forward-confirm, amazon, unread, zelle-sent, deposit or sermon-notes, not %q", a.Kind)}
	}
	for name, value := range map[string]string{"amount": a.Amount, "merchant": a.Merchant, "subject": a.Subject, "code": a.Code, "memo": a.Memo, "title": a.Title, "reference": a.Reference} {
		if utf8.RuneCountInString(value) > MaxFieldRunes {
			return &InvalidError{Msg: name + " is longer than " + fmt.Sprint(MaxFieldRunes) + " characters; an alert holds parsed facts, never a mail body"}
		}
	}
	if a.Link != "" && !IsConfirmLink(a.Link) {
		return &InvalidError{Msg: "link must be a Gmail forwarding confirmation link (https://mail.google.com/mail/vf-..., or on mail-settings.google.com or isolated.mail.google.com) of at most " + fmt.Sprint(MaxLinkRunes) + " characters"}
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
			s.removeNotes(id)
			return true, nil
		}
	}
	return false, nil
}

// Sweep drops every alert older than Keep, and its notes, and answers how
// many. Notes that no kept alert names (left by a claim or an add that failed
// halfway) are removed too.
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
	if dropped > 0 {
		previous := s.data.Alerts
		s.data.Alerts = kept
		if err := s.save(); err != nil {
			s.data.Alerts = previous
			return 0, err
		}
	}
	return dropped, s.sweepNotes()
}

// sweepNotes removes every file in the notes directory that is not the notes
// of a kept alert. Callers hold s.mu.
func (s *Store) sweepNotes() error {
	entries, err := os.ReadDir(s.notesDir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("reading the notes directory: %w", err)
	}
	named := map[string]bool{}
	for _, a := range s.data.Alerts {
		if a.NotesSize > 0 {
			named[a.ID+".pdf"] = true
		}
	}
	for _, e := range entries {
		if !named[e.Name()] {
			if err := os.RemoveAll(filepath.Join(s.notesDir, e.Name())); err != nil {
				return fmt.Errorf("removing notes no alert names: %w", err)
			}
		}
	}
	return nil
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
