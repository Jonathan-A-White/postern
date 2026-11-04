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
	return s.notifyEach(keys, payload, func(Subscription) Payload { return payload })
}

// notifyEach pushes to every subscription of keys what pick says that subscription gets; class
// names the push in the one log line for a key withheld in Ideas only.
func (s *Sender) notifyEach(keys []string, class Payload, pick func(Subscription) Payload) (int, error) {
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
			body, err := json.Marshal(pick(sub))
			if err != nil {
				return sent, fmt.Errorf("marshaling push payload: %w", err)
			}
			ok, err := s.deliver(sub, body, defaultTTL)
			if err != nil {
				errs = append(errs, err)
			}
			if ok {
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
	Charge   bool
	Amount   string
	Merchant string
	Last4    string
}

// NotifyAlert pushes a new alert to every subscription of keys, as NotifyKeys does, but a charge
// goes with its amount, merchant, last four and id to a subscription that sent a list of cards
// when the charge's card is on that list, the charge has no card, or no subscription anywhere
// lists that card (the app's "anyone"). Every other subscription, and every subscription that
// sent no list, gets the bare notice, whatever the alert. Nothing about the charge is logged.
func (s *Sender) NotifyAlert(keys []string, ts int64, facts AlertFacts) (int, error) {
	bare := Payload{Class: "alert", Ts: ts, Title: "New alert"}
	full := bare
	full.Amount, full.Merchant, full.Last4, full.AlertID = facts.Amount, facts.Merchant, facts.Last4, facts.ID
	anyone := facts.Charge && (facts.Last4 == "" || !s.store.Claims(facts.Last4))
	return s.notifyEach(keys, bare, func(sub Subscription) Payload {
		if !facts.Charge || len(sub.Last4s) == 0 {
			return bare
		}
		if anyone || containsString(sub.Last4s, facts.Last4) {
			return full
		}
		return bare
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
