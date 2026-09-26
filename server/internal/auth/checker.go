package auth

import (
	"sync"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/licence"
)

// LicenceChecker reports whether a public key holds a licence. Implemented
// by *CachedChecker; a handler test can fake it directly to avoid standing
// up a chain reader at all.
type LicenceChecker interface {
	Held(pubKeyHex string) (bool, error)
}

type checkerEntry struct {
	held      bool
	checkedAt time.Time
}

// CachedChecker answers licence.Held for a public key, caching the result a
// bounded time so every proved request doesn't re-walk the chain.
type CachedChecker struct {
	reader licence.Reader
	ttl    time.Duration
	now    func() time.Time

	mu    sync.Mutex
	cache map[string]checkerEntry
}

// CachedCheckerOption configures a CachedChecker constructed by
// NewCachedChecker.
type CachedCheckerOption func(*CachedChecker)

// WithCheckerClock overrides the clock a CachedChecker uses to stamp and
// check its cache entries' age, so tests can control time without sleeping.
func WithCheckerClock(now func() time.Time) CachedCheckerOption {
	return func(c *CachedChecker) { c.now = now }
}

// NewCachedChecker builds a CachedChecker backed by reader, caching each
// key's answer for ttl.
func NewCachedChecker(reader licence.Reader, ttl time.Duration, opts ...CachedCheckerOption) *CachedChecker {
	c := &CachedChecker{
		reader: reader,
		ttl:    ttl,
		now:    time.Now,
		cache:  make(map[string]checkerEntry),
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// Held reports whether pubKeyHex holds a licence (licence.Held, applied to
// the testnet address that key derives), reusing a cached answer under ttl.
func (c *CachedChecker) Held(pubKeyHex string) (bool, error) {
	c.mu.Lock()
	entry, ok := c.cache[pubKeyHex]
	c.mu.Unlock()
	if ok && c.now().Sub(entry.checkedAt) < c.ttl {
		return entry.held, nil
	}

	address, err := licence.AddressForPublicKey(pubKeyHex)
	if err != nil {
		return false, err
	}
	held, err := licence.Held(c.reader, address)
	if err != nil {
		return false, err
	}

	c.mu.Lock()
	c.cache[pubKeyHex] = checkerEntry{held: held, checkedAt: c.now()}
	c.mu.Unlock()

	return held, nil
}
