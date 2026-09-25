package push

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

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
	To    string `json:"to"`
	Class string `json:"class"`
	Ts    int64  `json:"ts"`
}

// pushBody is what's sent as the push message itself — no plaintext, ever;
// the app decrypts the actual record content itself once it opens the app.
type pushBody struct {
	Class string `json:"class"`
	TxID  string `json:"txid"`
	Ts    int64  `json:"ts"`
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

	var addressed addressedPayload
	if err := json.Unmarshal(payload, &addressed); err != nil {
		return nil
	}
	if addressed.To == "" || addressed.Class == "" {
		return nil
	}

	subs := s.store.ByPublicKey(addressed.To)
	if len(subs) == 0 {
		return nil
	}

	body, err := json.Marshal(pushBody{Class: addressed.Class, TxID: txid, Ts: addressed.Ts})
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

// send pushes body to sub's endpoint, dropping sub from the store if the
// push service reports it gone (410) — the standard signal that the browser
// unsubscribed or the installation was uninstalled.
func (s *Sender) send(sub Subscription, body []byte) error {
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
		return fmt.Errorf("sending push to %s: %w", sub.Endpoint, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusGone {
		return s.store.Remove(sub.Endpoint)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("push endpoint %s said %d", sub.Endpoint, resp.StatusCode)
	}
	return nil
}
