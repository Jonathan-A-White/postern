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

// CollectionChecker names the collections a public key holds licences in,
// which say what the key may do (docs/protocol.md §19). A LicenceChecker
// that is not also a CollectionChecker licenses every key it holds as a
// cockpit key.
type CollectionChecker interface {
	HeldCollections(pubKeyHex string) ([]string, error)
}

type checkerEntry struct {
	collections []string
	checkedAt   time.Time
}

// CachedChecker answers licence.Held for a public key, caching the result a
// bounded time so every proved request doesn't re-walk the chain.
type CachedChecker struct {
	reader licence.Reader
	rule   licence.Rule
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

// WithRule sets the licence rule the checker applies (collections, issuer).
// Without it, licence.Rule's zero value: the default collections, no issuer.
func WithRule(rule licence.Rule) CachedCheckerOption {
	return func(c *CachedChecker) { c.rule = rule }
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

// Held reports whether pubKeyHex holds a licence (licence.Held under the
// checker's rule, applied to the testnet address that key derives), reusing
// a cached answer under ttl.
func (c *CachedChecker) Held(pubKeyHex string) (bool, error) {
	collections, err := c.HeldCollections(pubKeyHex)
	return len(collections) > 0, err
}

// HeldCollections names the collections pubKeyHex holds licences in
// (licence.HeldCollections under the checker's rule), reusing a cached
// answer under ttl.
func (c *CachedChecker) HeldCollections(pubKeyHex string) ([]string, error) {
	c.mu.Lock()
	entry, ok := c.cache[pubKeyHex]
	c.mu.Unlock()
	if ok && c.now().Sub(entry.checkedAt) < c.ttl {
		return entry.collections, nil
	}

	address, err := licence.AddressForPublicKey(pubKeyHex)
	if err != nil {
		return nil, err
	}
	collections, err := licence.HeldCollections(c.reader, address, c.rule)
	if err != nil {
		return nil, err
	}

	c.mu.Lock()
	c.cache[pubKeyHex] = checkerEntry{collections: collections, checkedAt: c.now()}
	c.mu.Unlock()

	return collections, nil
}
