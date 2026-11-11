package push

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
)

// NotifyKeys pushes payload, which has no record behind it, to every
// subscription registered for any of keys, and reports how many push services
// accepted it. It is how a family's alert reaches every phone of the family
// (docs/protocol.md §26): the keys are the family's devices, cockpit or app
// keys alike. A key in Ideas only (§25) is not pushed, as for any class but a
// ring and an emergency. A subscription whose service says it is gone is
// dropped, as NotifyRecord does.
func (s *Sender) NotifyKeys(keys []string, payload Payload) (int, error) {
	return s.notifyEach(keys, payload, func(Subscription) (Payload, bool) { return payload, true })
}

// notifyEach pushes to every subscription of keys what pick says that subscription gets, or nothing
// when pick says false (such a subscription is neither sent to nor counted); class names the push
// in the one log line for a key withheld in Ideas only.
func (s *Sender) notifyEach(keys []string, class Payload, pick func(Subscription) (Payload, bool)) (int, error) {
	var errs []error
	sent := 0
	for _, key := range keys {
		if s.ideas != nil {
			if _, state := s.ideas.Get(key); state.On {
				log.Printf("push of %s: withheld from a device while Ideas only is on", class.Class)
				continue
			}
		}
		for _, sub := range s.store.ByPublicKey(key) {
			payload, ok := pick(sub)
			if !ok {
				continue
			}
			body, err := json.Marshal(payload)
			if err != nil {
				return sent, fmt.Errorf("marshaling push payload: %w", err)
			}
			delivered, err := s.deliver(sub, body, defaultTTL)
			if err != nil {
				errs = append(errs, err)
			}
			if delivered {
				sent++
			}
		}
	}
	return sent, errors.Join(errs...)
}

// AlertFacts is what an alert push may carry beyond the bare notice: a charge's
// amount, merchant and card, and the alert's id. Charge is false for every other
// kind of alert, which is pushed bare to all.
type AlertFacts struct {
	ID       string
	Kind     string // the alert's kind (charge, forward-confirm); every alert push names it
	Charge   bool
	Amount   string
	Merchant string
	Last4    string
}

// NotifyAlert pushes a new alert to every subscription of keys, as NotifyKeys does (the API calls it only for a charge or a forwarding confirmation), but a charge
// goes with its amount, merchant, last four and id to a subscription that sent a list of cards
// when the charge's card is on that list, the charge has no card, or no subscription anywhere
// lists that card (the app's "anyone"). A subscription with a list that does not name the charge's
// card, while another's list does, gets no push at all (it is not the person's charge). A
// subscription that sent no list gets the bare notice, whatever the alert, and so does every
// subscription for an alert that is not a charge. Nothing about the charge is logged, and a
// withheld push has no log line (the sent count leaves it out).
func (s *Sender) NotifyAlert(keys []string, ts int64, facts AlertFacts) (int, error) {
	bare := Payload{Class: "alert", Ts: ts, Title: "New alert", Kind: facts.Kind}
	full := bare
	full.Amount, full.Merchant, full.Last4, full.AlertID = facts.Amount, facts.Merchant, facts.Last4, facts.ID
	anyone := facts.Charge && (facts.Last4 == "" || !s.store.Claims(facts.Last4))
	return s.notifyEach(keys, bare, func(sub Subscription) (Payload, bool) {
		if !facts.Charge || len(sub.Last4s) == 0 {
			return bare, true
		}
		if anyone || containsString(sub.Last4s, facts.Last4) {
			return full, true
		}
		return Payload{}, false
	})
}

func containsString(list []string, want string) bool {
	for _, s := range list {
		if s == want {
			return true
		}
	}
	return false
}
