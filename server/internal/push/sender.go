package push

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/Jonathan-A-White/postern/server/internal/index"
	webpush "github.com/SherClockHolmes/webpush-go"
)

// Sender pushes a classified notification to every subscription addressed
// by a record's payload.
type Sender struct {
	keys       VAPIDKeys
	subscriber string
	store      *Store
	httpClient webpush.HTTPClient
}

// NewSender builds a Sender that signs pushes with keys, identifies this
// backend to push services as subscriber (an https URL or email address, per
// VAPID), and looks up (and prunes) subscriptions in store.
func NewSender(keys VAPIDKeys, subscriber string, store *Store) *Sender {
	return &Sender{keys: keys, subscriber: subscriber, store: store}
}

// WithHTTPClient overrides the HTTP client used to reach a push endpoint.
func (s *Sender) WithHTTPClient(client webpush.HTTPClient) *Sender {
	s.httpClient = client
	return s
}

// addressedPayload is the subset of docs/protocol.md's message payload that
// push cares about: who it's for and what class it is. Any other record
// shape (a License mint/transfer record, a payload missing these fields)
// simply doesn't unmarshal into a non-empty To/Class and is skipped.
type addressedPayload struct {
	To      string `json:"to"`
	Class   string `json:"class"`
	Ts      int64  `json:"ts"`
	Summary string `json:"summary"`
}

// directPrefix is api.DirectPrefix: the start of every directly delivered
// record's txid. push cannot import api (api imports push), so the value is
// kept here; a chain txid is 64 hex and never starts with it.
const directPrefix = "direct:"

// maxSummaryRunes is the longest summary a push carries (docs/protocol.md §1).
const maxSummaryRunes = 80

// Payload is what's sent as the push message itself. For a record it is
// {class, txid, ts}: nothing the sender did not put in the clear leaves the
// backend, and the app decrypts the record's content itself once it opens. The
// one exception is a direct record's clear `summary` (docs/protocol.md §1),
// which becomes Body. Title and Body are otherwise set only by a push that has
// no record behind it (the watchdog's alarms); the service worker shows them
// when present.
type Payload struct {
	Class string `json:"class"`
	TxID  string `json:"txid,omitempty"`
	Ts    int64  `json:"ts"`
	Title string `json:"title,omitempty"`
	Body  string `json:"body,omitempty"`
}

// RecordIndexed pushes a newly indexed record (NotifyRecord) in its own
// goroutine, so a slow push service never holds up the poller or a direct
// delivery's response; a failure is logged. It makes *Sender a
// notify.Notifier.
func (s *Sender) RecordIndexed(rec index.Record) {
	go func() {
		if err := s.NotifyRecord(rec.TxID, rec.Payload); err != nil {
			log.Printf("push for record %d (%s): %v", rec.Seq, rec.TxID, err)
		}
	}()
}

// NotifyRecord sends a push, tagged with the payload's class, to every
// subscription whose public key matches the payload's `to` field. A record
// with no payload, a payload with no `to`/`class`, or a `to` no device has
// subscribed for is silently skipped — most records this backend ever
// indexes (License mint/transfer records, an unaddressed payload) aren't
// push-worthy.
func (s *Sender) NotifyRecord(txid string, payload json.RawMessage) error {
	if len(payload) == 0 {
		return nil
	}

	addressed, push, ok := parseAddressed(txid, payload)
	if !ok {
		return nil
	}

	subs := s.store.ByPublicKey(addressed.To)
	if len(subs) == 0 {
		return nil
	}

	body, err := json.Marshal(push)
	if err != nil {
		return fmt.Errorf("marshaling push payload: %w", err)
	}

	var errs []error
	for _, sub := range subs {
		if err := s.send(sub, body); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// recordPush is the push a record's payload asks for, and false for a record
// that is not addressed (no payload, no `to`/`class`) and so is not push-worthy.
func recordPush(txid string, payload json.RawMessage) (Payload, bool) {
	_, push, ok := parseAddressed(txid, payload)
	return push, ok
}

func parseAddressed(txid string, payload json.RawMessage) (addressedPayload, Payload, bool) {
	var addressed addressedPayload
	if len(payload) == 0 || json.Unmarshal(payload, &addressed) != nil {
		return addressed, Payload{}, false
	}
	if addressed.To == "" || addressed.Class == "" {
		return addressed, Payload{}, false
	}
	push := Payload{Class: addressed.Class, TxID: txid, Ts: addressed.Ts}
	if strings.HasPrefix(txid, directPrefix) && summaryPushed(addressed.Class) {
		push.Body = clipSummary(addressed.Summary)
	}
	return addressed, push, true
}

// summaryPushed reports whether a record of this class may show its summary in
// a push: the four cockpit classes. A non-cockpit app key may send grist
// (docs/protocol.md §19); its summary is never pushed.
func summaryPushed(class string) bool {
	switch class {
	case "message", "decision-needed", "landing", "alarm":
		return true
	}
	return false
}

// clipSummary trims summary and cuts it to maxSummaryRunes runes (not bytes).
func clipSummary(summary string) string {
	summary = strings.TrimSpace(summary)
	if runes := []rune(summary); len(runes) > maxSummaryRunes {
		summary = strings.TrimSpace(string(runes[:maxSummaryRunes]))
	}
	return summary
}

// Broadcast pushes payload to every stored subscription, whoever it is
// registered for, and reports how many push services accepted it. A
// subscription whose service answers 410 is dropped, as NotifyRecord does.
func (s *Sender) Broadcast(payload Payload) (delivered int, err error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return 0, fmt.Errorf("marshaling push payload: %w", err)
	}

	var errs []error
	for _, sub := range s.store.All() {
		ok, err := s.deliver(sub, body)
		if err != nil {
			errs = append(errs, err)
		}
		if ok {
			delivered++
		}
	}
	return delivered, errors.Join(errs...)
}

// send pushes body to sub's endpoint, dropping sub from the store if the
// push service reports it gone (410) — the standard signal that the browser
// unsubscribed or the installation was uninstalled.
func (s *Sender) send(sub Subscription, body []byte) error {
	_, err := s.deliver(sub, body)
	return err
}

// deliver is send, also reporting whether the push service accepted the
// push (a 2xx).
func (s *Sender) deliver(sub Subscription, body []byte) (bool, error) {
	resp, err := webpush.SendNotificationWithContext(context.Background(), body, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     sub.Keys,
	}, &webpush.Options{
		HTTPClient:      s.httpClient,
		Subscriber:      s.subscriber,
		TTL:             30,
		Urgency:         webpush.UrgencyHigh,
		VAPIDPublicKey:  s.keys.PublicKey,
		VAPIDPrivateKey: s.keys.PrivateKey,
	})
	if err != nil {
		return false, fmt.Errorf("sending push to %s: %w", sub.Endpoint, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusGone {
		return false, s.store.Remove(sub.Endpoint)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return false, fmt.Errorf("push endpoint %s said %d", sub.Endpoint, resp.StatusCode)
	}
	return true, nil
}
