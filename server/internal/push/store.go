package push

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
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
// when a push endpoint reports itself gone (410).
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
