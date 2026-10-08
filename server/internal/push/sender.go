package push

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

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
	twins      *twinMemory
	timeout    time.Duration
}

// NewSender builds a Sender that signs pushes with keys, identifies this
// backend to push services as subscriber (an https URL or email address, per
// VAPID), and looks up (and prunes) subscriptions in store.
func NewSender(keys VAPIDKeys, subscriber string, store *Store) *Sender {
	return &Sender{keys: keys, subscriber: subscriber, store: store, timeout: defaultTimeout, twins: newTwinMemory(twinMemoryTTL, twinMemoryCap)}
}

// defaultTimeout bounds one push: a push service that never answers must not hold a goroutine
// (or a Broadcast) forever.
const defaultTimeout = 15 * time.Second

// WithTimeout overrides how long one push may take (defaultTimeout). It bounds the request's
// context, so it holds for an injected HTTP client that has no timeout of its own.
func (s *Sender) WithTimeout(d time.Duration) *Sender {
	s.timeout = d
	return s
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
	From    string `json:"from"`
	Ct      string `json:"ct"`
	Summary string `json:"summary"`
	// Role is a call record's clear role (docs/protocol.md §21): only a "ring" is pushed.
	Role string `json:"role"`
	// Lane is an events record's clear lane (docs/protocol.md §22): only an "emergency" is pushed.
	Lane string `json:"lane"`
	// Channel and Bead are the optional clear names of the channel a message belongs to (a named
	// channel, or a bead's own); a message's push title names it. Absent, the class title stands.
	Channel string `json:"channel"`
	Bead    string `json:"bead"`
}

// directPrefix is api.DirectPrefix: the start of every directly delivered
// record's txid. push cannot import api (api imports push), so the value is
// kept here; a chain txid is 64 hex and never starts with it.
const directPrefix = "direct:"

// ringClass and ringRole name the one call record that is pushed (docs/protocol.md §21),
// and ringTitle is the title that push carries.
const (
	ringClass = "call"
	ringRole  = "ring"
	ringTitle = "The Mayor is calling"

	messageClass = "message"

	eventsClass    = "events"
	emergencyLane  = "emergency"
	emergencyTitle = "Emergency"
)

// A push's time to live: how long a push service keeps it for a phone that is off or dozing.
// An ordinary push is worth nothing late, so it lives 30 s; an emergency lives an hour, long
// enough for a locked, low-battery phone to wake and be reached (mw-gq6.203).
const (
	defaultTTL   = 30
	emergencyTTL = 3600
)

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

	sent := 0
	// One notification per message: its other copy (direct or chain) may already have been pushed.
	if key := twinKey(addressed); key != "" {
		if !s.twins.claim(key) {
			log.Printf("push for record %s: skipped, its twin was already pushed", txid)
			return nil
		}
		defer func() {
			if sent == 0 {
				s.twins.release(key)
			}
		}()
	}

	ttl := defaultTTL
	if addressed.Class == eventsClass {
		ttl = emergencyTTL // parseAddressed lets an events record through only in the emergency lane
	}

	var errs []error
	for _, sub := range subs {
		ok, err := s.deliver(sub, body, ttl)
		if err != nil {
			errs = append(errs, err)
		}
		if ok {
			sent++
		}
	}
	if sent > 0 {
		log.Printf("push for record %s: sent to %d device(s)", txid, sent)
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
	if addressed.Class == eventsClass && addressed.Lane != emergencyLane {
		return addressed, Payload{}, false // an events record is pushed only in the emergency lane (§22)
	}
	push := Payload{Class: addressed.Class, TxID: txid, Ts: addressed.Ts}
	if addressed.Class == eventsClass {
		push.Title = emergencyTitle // its words are sealed: the push names the lane and nothing else
		return addressed, push, true
	}
	if addressed.Class == ringClass {
		// A call record is pushed only when it is the Mayor's ring, named so in the clear;
		// its reason, when it rides as a direct record's summary, is the body.
		if addressed.Role != ringRole {
			return addressed, Payload{}, false
		}
		push.Title = ringTitle
		if strings.HasPrefix(txid, directPrefix) {
			push.Body = clipSummary(addressed.Summary)
		}
		return addressed, push, true
	}
	if addressed.Class == messageClass {
		// The title names the channel when the record names one in the clear, chain or direct.
		push.Title = messageTitle(addressed)
	}
	if strings.HasPrefix(txid, directPrefix) && summaryPushed(addressed.Class) {
		push.Body = clipSummary(addressed.Summary)
	}
	return addressed, push, true
}

// messageTitle is a message push's title when its record names its channel in the clear:
// "Message on <bead id>" for a bead's channel (which outranks a name), "Message in <name>" for a
// named one, and "" when neither is named, so the app's own "Message" stands.
func messageTitle(addressed addressedPayload) string {
	if bead := clipSummary(addressed.Bead); bead != "" {
		return "Message on " + bead
	}
	if channel := clipSummary(addressed.Channel); channel != "" {
		return "Message in " + channel
	}
	return ""
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
// subscription whose service answers 410 or 404 is dropped, as NotifyRecord does.
func (s *Sender) Broadcast(payload Payload) (delivered int, err error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return 0, fmt.Errorf("marshaling push payload: %w", err)
	}

	var errs []error
	for _, sub := range s.store.All() {
		ok, err := s.deliver(sub, body, defaultTTL)
		if err != nil {
			errs = append(errs, err)
		}
		if ok {
			delivered++
		}
	}
	return delivered, errors.Join(errs...)
}

// deliver pushes body to sub's endpoint, to be kept ttl seconds, and reports whether the push
// service accepted it (a 2xx). It drops sub from the store if the service reports it gone (410,
// or 404 as FCM answers for a dead endpoint): the signal that the browser unsubscribed or the
// installation was uninstalled. The request is cut off after the sender's timeout.
func (s *Sender) deliver(sub Subscription, body []byte, ttl int) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), s.timeout)
	defer cancel()
	client := s.httpClient
	if client == nil {
		client = &http.Client{Timeout: s.timeout}
	}
	resp, err := webpush.SendNotificationWithContext(ctx, body, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     sub.Keys,
	}, &webpush.Options{
		HTTPClient:      client,
		Subscriber:      s.subscriber,
		TTL:             ttl,
		Urgency:         webpush.UrgencyHigh,
		VAPIDPublicKey:  s.keys.PublicKey,
		VAPIDPrivateKey: s.keys.PrivateKey,
	})
	if err != nil {
		return false, fmt.Errorf("sending push to %s: %w", sub.Endpoint, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusGone || resp.StatusCode == http.StatusNotFound {
		return false, s.store.Remove(sub.Endpoint)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return false, fmt.Errorf("push endpoint %s said %d", sub.Endpoint, resp.StatusCode)
	}
	return true, nil
}
