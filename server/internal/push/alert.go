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
	body, err := json.Marshal(payload)
	if err != nil {
		return 0, fmt.Errorf("marshaling push payload: %w", err)
	}
	var errs []error
	sent := 0
	for _, key := range keys {
		if s.ideas != nil {
			if _, state := s.ideas.Get(key); state.On {
				log.Printf("push of %s: withheld from a device while Ideas only is on", payload.Class)
				continue
			}
		}
		for _, sub := range s.store.ByPublicKey(key) {
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
