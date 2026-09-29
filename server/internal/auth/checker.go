package auth

import (
	"log"
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

// walkCall is one chain walk in flight for a key; everyone who wants that
// key's answer meanwhile waits on done instead of starting a walk of their
// own.
type walkCall struct {
	done        chan struct{}
	collections []string
	err         error
}

// DefaultStaleGrace is how long past its ttl a key's last good answer is
// still served when the chain cannot be reached to refresh it.
const DefaultStaleGrace = time.Hour

// CachedChecker answers licence.Held for a public key, caching the result a
// bounded time so every proved request doesn't re-walk the chain. It never
// walks the chain twice at once for one key, and once a key has been
// checked an expired answer is served at once while one background walk
// refreshes it (stale-while-revalidate), for as long as the answer is
// within ttl plus the grace: a refresh that fails is logged and the last
// good answer stands until then.
type CachedChecker struct {
	reader licence.Reader
	rule   licence.Rule
	ttl    time.Duration
	grace  time.Duration
	now    func() time.Time
	walk   func(address string) ([]string, error)

	mu       sync.Mutex
	cache    map[string]checkerEntry
	inflight map[string]*walkCall
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

// WithStaleGrace sets how long past its ttl an answer may still be served
// (while a refresh runs, or after refreshes fail). Without it,
// DefaultStaleGrace.
func WithStaleGrace(grace time.Duration) CachedCheckerOption {
	return func(c *CachedChecker) { c.grace = grace }
}

// withWalk replaces the chain walk itself, so a test can script its answers.
func withWalk(walk func(address string) ([]string, error)) CachedCheckerOption {
	return func(c *CachedChecker) { c.walk = walk }
}

// NewCachedChecker builds a CachedChecker backed by reader, caching each
// key's answer for ttl.
func NewCachedChecker(reader licence.Reader, ttl time.Duration, opts ...CachedCheckerOption) *CachedChecker {
	c := &CachedChecker{
		reader:   reader,
		ttl:      ttl,
		grace:    DefaultStaleGrace,
		now:      time.Now,
		cache:    make(map[string]checkerEntry),
		inflight: make(map[string]*walkCall),
	}
	c.walk = func(address string) ([]string, error) {
		return licence.HeldCollections(c.reader, address, c.rule)
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
// (licence.HeldCollections under the checker's rule). A fresh cached answer
// is returned as is; an expired one within the grace is returned at once
// with one background refresh started; with no usable answer the caller
// waits on a walk that every concurrent caller for the key shares.
func (c *CachedChecker) HeldCollections(pubKeyHex string) ([]string, error) {
	address, err := licence.AddressForPublicKey(pubKeyHex)
	if err != nil {
		return nil, err
	}

	c.mu.Lock()
	entry, ok := c.cache[pubKeyHex]
	age := c.now().Sub(entry.checkedAt)
	if ok && age < c.ttl {
		c.mu.Unlock()
		return entry.collections, nil
	}
	if ok && age < c.ttl+c.grace {
		call, started := c.startWalkLocked(pubKeyHex, address)
		c.mu.Unlock()
		if started {
			go c.refresh(pubKeyHex, address, call)
		}
		return entry.collections, nil
	}
	if ok {
		delete(c.cache, pubKeyHex) // past the grace: not to be trusted
	}
	call, started := c.startWalkLocked(pubKeyHex, address)
	c.mu.Unlock()
	if started {
		c.run(pubKeyHex, address, call)
	}
	<-call.done
	return call.collections, call.err
}

// startWalkLocked returns key's walk in flight, registering a new one (and
// reporting started) when there is none. c.mu must be held. The caller that
// gets started must run the walk and finish the call.
func (c *CachedChecker) startWalkLocked(key, address string) (call *walkCall, started bool) {
	if call, ok := c.inflight[key]; ok {
		return call, false
	}
	call = &walkCall{done: make(chan struct{})}
	c.inflight[key] = call
	return call, true
}

// run walks the chain for key's address, caches a good answer, and releases
// everyone waiting on call.
func (c *CachedChecker) run(key, address string, call *walkCall) {
	collections, err := c.walk(address)
	c.mu.Lock()
	if err == nil {
		c.cache[key] = checkerEntry{collections: collections, checkedAt: c.now()}
	}
	delete(c.inflight, key)
	c.mu.Unlock()
	call.collections, call.err = collections, err
	close(call.done)
}

// refresh is the background walk behind a stale answer; a failure is logged
// and leaves the last good answer in place.
func (c *CachedChecker) refresh(key, address string, call *walkCall) {
	c.run(key, address, call)
	if call.err != nil {
		log.Printf("licence refresh for %s failed, keeping the last answer for up to %s: %v", key, c.grace, call.err)
	}
}

// refreshing reports whether a walk for key is in flight.
func (c *CachedChecker) refreshing(key string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, ok := c.inflight[key]
	return ok
}
