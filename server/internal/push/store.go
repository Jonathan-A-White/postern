package push

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	webpush "github.com/SherClockHolmes/webpush-go"
)

const subscriptionsFileName = "postern-push-subscriptions.json"

// Subscription is one device's push registration: the recipient public key
// (docs/protocol.md's `to`, hex) it's addressed as, and the browser's own
// PushSubscription (endpoint + keys) needed to push to it.
type Subscription struct {
	PublicKeyHex string       `json:"pubkey"`
	Endpoint     string       `json:"endpoint"`
	Keys         webpush.Keys `json:"keys"`
	// Last4s are the card last-fours this device is for (docs/protocol.md §26, The push); none
	// means it sent no list, and an alert reaches it bare. A re-subscribe replaces the list.
	Last4s []string `json:"last4s,omitempty"`
}

// Store is the durable set of push subscriptions, persisted as one JSON file
// in POSTERN_DATA. Safe for concurrent use.
type Store struct {
	mu   sync.Mutex
	path string
	subs []Subscription
}

// OpenStore loads dir/postern-push-subscriptions.json (starting empty if it
// doesn't exist yet) into a Store ready for Add, Remove, and ByPublicKey.
func OpenStore(dir string) (*Store, error) {
	path := filepath.Join(dir, subscriptionsFileName)
	store := &Store{path: path}

	data, err := os.ReadFile(path)
	if err == nil {
		if err := json.Unmarshal(data, &store.subs); err != nil {
			return nil, fmt.Errorf("parsing %s: %w", path, err)
		}
		return store, nil
	}
	if !os.IsNotExist(err) {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}
	return store, nil
}

// Add stores sub, replacing any existing subscription with the same
// endpoint (a re-subscribe from the same browser installation).
func (s *Store) Add(sub Subscription) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i, existing := range s.subs {
		if existing.Endpoint == sub.Endpoint {
			s.subs[i] = sub
			return s.save()
		}
	}
	s.subs = append(s.subs, sub)
	return s.save()
}

// Remove deletes the subscription with the given endpoint, if any — used
// when a push endpoint reports itself gone (410, or 404 as FCM answers).
func (s *Store) Remove(endpoint string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	out := s.subs[:0]
	for _, existing := range s.subs {
		if existing.Endpoint != endpoint {
			out = append(out, existing)
		}
	}
	s.subs = out
	return s.save()
}

// ByPublicKey returns every subscription registered for pubkeyHex.
func (s *Store) ByPublicKey(pubkeyHex string) []Subscription {
	s.mu.Lock()
	defer s.mu.Unlock()

	var matches []Subscription
	for _, sub := range s.subs {
		if sub.PublicKeyHex == pubkeyHex {
			matches = append(matches, sub)
		}
	}
	return matches
}

// Claims reports whether any subscription lists last4, which is how an alert's
// card is known to have an owner at all.
func (s *Store) Claims(last4 string) bool {
	if last4 == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, sub := range s.subs {
		for _, l := range sub.Last4s {
			if l == last4 {
				return true
			}
		}
	}
	return false
}

// All returns every stored subscription.
func (s *Store) All() []Subscription {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Subscription(nil), s.subs...)
}

// save persists the current subscription list. Callers must hold s.mu.
func (s *Store) save() error {
	data, err := json.Marshal(s.subs)
	if err != nil {
		return fmt.Errorf("marshaling subscriptions: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return fmt.Errorf("creating data directory: %w", err)
	}
	if err := os.WriteFile(s.path, data, 0o600); err != nil {
		return fmt.Errorf("writing %s: %w", s.path, err)
	}
	return nil
}

// MaxLast4s is the most cards one subscription may name.
const MaxLast4s = 32

// CleanLast4s checks the list of card last-fours a device sends when it subscribes (docs/api.md):
// at most MaxLast4s, each 1 to 4 digits. It returns the list without repeats, and nil for an empty
// one, which is the same as sending none.
func CleanLast4s(list []string) ([]string, error) {
	if len(list) > MaxLast4s {
		return nil, fmt.Errorf("last4s holds at most %d cards", MaxLast4s)
	}
	var out []string
	seen := map[string]bool{}
	for _, l := range list {
		if len(l) < 1 || len(l) > 4 || strings.Trim(l, "0123456789") != "" {
			return nil, fmt.Errorf("last4s holds card last fours, 1 to 4 digits each")
		}
		if !seen[l] {
			seen[l] = true
			out = append(out, l)
		}
	}
	return out, nil
}
