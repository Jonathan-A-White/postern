// Package auth guards postern's data endpoints: a caller proves it holds a
// licensed key by signing a short-lived nonce (GET /api/challenge) with that
// key, the same proof the PWA is expected to send (mw-f758y.22.2).
package auth

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

const nonceBytes = 32

// NonceStore issues short-lived, single-use nonces and consumes them. Safe
// for concurrent use.
type NonceStore struct {
	ttl time.Duration
	now func() time.Time

	mu     sync.Mutex
	nonces map[string]time.Time // nonce -> expiry
}

// NonceStoreOption configures a NonceStore constructed by NewNonceStore.
type NonceStoreOption func(*NonceStore)

// WithClock overrides the clock a NonceStore uses to stamp and check
// expiry, so tests can control time without sleeping.
func WithClock(now func() time.Time) NonceStoreOption {
	return func(s *NonceStore) { s.now = now }
}

// NewNonceStore builds a NonceStore whose issued nonces expire after ttl.
func NewNonceStore(ttl time.Duration, opts ...NonceStoreOption) *NonceStore {
	s := &NonceStore{
		ttl:    ttl,
		now:    time.Now,
		nonces: make(map[string]time.Time),
	}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

// Issue generates a new random nonce (hex-encoded), records its expiry, and
// returns it.
func (s *NonceStore) Issue() (string, error) {
	raw := make([]byte, nonceBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generating nonce: %w", err)
	}
	nonce := hex.EncodeToString(raw)

	s.mu.Lock()
	s.nonces[nonce] = s.now().Add(s.ttl)
	s.mu.Unlock()

	return nonce, nil
}

// Consume reports whether nonce was issued and has not yet expired or been
// consumed, removing it either way so it can never be presented again.
func (s *NonceStore) Consume(nonce string) bool {
	s.mu.Lock()
	expiry, ok := s.nonces[nonce]
	delete(s.nonces, nonce)
	s.mu.Unlock()

	if !ok {
		return false
	}
	return !s.now().After(expiry)
}
