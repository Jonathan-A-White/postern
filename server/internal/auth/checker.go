package auth

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/chain"
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
	restored    bool // read back from disk at start, by an earlier life of the backend
	kept        bool // its key's history is too long to read: the last good answer stands until a walk reads it
}

// walkCall is one chain walk in flight for a key; everyone who wants that
// key's answer meanwhile waits on done instead of starting a walk of their
// own.
type walkCall struct {
	done        chan struct{}
	collections []string
	err         error
}

// backoff is a key whose refresh the chain refused (a 429) or could not read
// (a history past the pages read): nothing is asked of the chain for it until
// until, and the answer it has stands meanwhile, however old. err is what the
// caller of a key with no answer is told.
type backoff struct {
	until time.Time
	err   error
}

// DefaultStaleGrace is how long past its ttl a key's last good answer is
// still served when the chain cannot be reached to refresh it.
const DefaultStaleGrace = time.Hour

// RestoredMaxAge is how old an answer read back from disk (WithPersistence)
// may be and still be served, at once, while the first refresh after the
// restart runs. It is far past the grace on purpose: a restart must never
// leave a request waiting on a cold walk for want of a recent answer.
const RestoredMaxAge = 30 * 24 * time.Hour

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
	find   func(address string, remembered []licence.Mint) (licence.Result, error)

	persistPath string // where answers are kept across restarts; empty keeps them in memory only
	persistMu   sync.Mutex

	mu       sync.Mutex
	cache    map[string]checkerEntry
	mints    map[string][]licence.Mint // each key's licence mints, remembered so a check need not find them again
	backoffs map[string]backoff
	inflight map[string]*walkCall

	background sync.WaitGroup // background refreshes started and not yet finished
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

// WithPersistence keeps every key's last good answer in the file at path,
// and starts from the answers an earlier life of the backend left there: a
// restored answer is served at once, whatever its age, while a background
// walk refreshes it, so a restart never leaves a request waiting on a cold
// walk over the chain. Only answers naming a collection are kept (a key
// with no licence waits for a walk as before), and a file written under
// another licence rule is ignored.
func WithPersistence(path string) CachedCheckerOption {
	return func(c *CachedChecker) { c.persistPath = path }
}

// withWalk replaces the chain walk itself, so a test can script its answers.
func withWalk(walk func(address string) ([]string, error)) CachedCheckerOption {
	return withFind(func(address string, _ []licence.Mint) (licence.Result, error) {
		collections, err := walk(address)
		return licence.Result{Collections: collections}, err
	})
}

// withFind is withWalk for a test that scripts the mints too.
func withFind(find func(address string, remembered []licence.Mint) (licence.Result, error)) CachedCheckerOption {
	return func(c *CachedChecker) { c.find = find }
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
		mints:    make(map[string][]licence.Mint),
		backoffs: make(map[string]backoff),
		inflight: make(map[string]*walkCall),
	}
	c.find = func(address string, remembered []licence.Mint) (licence.Result, error) {
		return licence.Find(c.reader, address, c.rule, remembered)
	}
	for _, opt := range opts {
		opt(c)
	}
	c.restore()
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
// is returned as is; an expired one within the grace (or one restored from
// disk) is returned at once with one background refresh started; with no
// usable answer the caller waits on a walk that every concurrent caller for
// the key shares.
func (c *CachedChecker) HeldCollections(pubKeyHex string) ([]string, error) {
	address, err := licence.AddressForPublicKey(pubKeyHex)
	if err != nil {
		return nil, err
	}

	c.mu.Lock()
	collections, ok, refresh := c.servedLocked(pubKeyHex, address)
	if ok {
		c.mu.Unlock()
		if refresh != nil {
			c.refreshInBackground(pubKeyHex, address, refresh)
		}
		return collections, nil
	}
	if wait, backed := c.backoffs[pubKeyHex]; backed && c.now().Before(wait.until) {
		c.mu.Unlock()
		return nil, wait.err // no retry inside the backoff, to a chain that said not now
	}
	call, started := c.startWalkLocked(pubKeyHex, address)
	c.mu.Unlock()
	if started {
		c.run(pubKeyHex, address, call)
	}
	<-call.done
	return call.collections, call.err
}

// CachedCollections is HeldCollections that never waits on the chain: the
// answer HeldCollections would serve at once, and false when there is none
// (a walk is then started in the background, so the next ask has one).
func (c *CachedChecker) CachedCollections(pubKeyHex string) ([]string, bool) {
	address, err := licence.AddressForPublicKey(pubKeyHex)
	if err != nil {
		return nil, false
	}

	c.mu.Lock()
	collections, ok, refresh := c.servedLocked(pubKeyHex, address)
	if wait, backed := c.backoffs[pubKeyHex]; !ok && !(backed && c.now().Before(wait.until)) {
		if call, started := c.startWalkLocked(pubKeyHex, address); started {
			refresh = call
		}
	}
	c.mu.Unlock()
	if refresh != nil {
		c.refreshInBackground(pubKeyHex, address, refresh)
	}
	return collections, ok
}

// servedLocked is the answer to serve key at once, if any: a fresh one as
// is, an expired one within the grace with a refresh to start when none is
// in flight (refresh is then the new walk, for the caller to run in the
// background), and one restored from disk within RestoredMaxAge likewise,
// however fresh: the first ask after a restart always refreshes. An answer
// past all that is dropped. c.mu must be held.
func (c *CachedChecker) servedLocked(key, address string) (collections []string, ok bool, refresh *walkCall) {
	entry, found := c.cache[key]
	if !found {
		return nil, false, nil
	}
	age := c.now().Sub(entry.checkedAt)
	if age < c.ttl && !entry.restored {
		return entry.collections, true, nil
	}
	wait, backed := c.backoffs[key]
	backed = backed && c.now().Before(wait.until)
	if backed {
		return entry.collections, true, nil // the chain said not now: serve what we have, ask nothing
	}
	if age < c.ttl+c.grace || (entry.restored && age < RestoredMaxAge) || entry.kept {
		if call, started := c.startWalkLocked(key, address); started {
			refresh = call
		}
		return entry.collections, true, refresh
	}
	delete(c.cache, key) // past the grace: not to be trusted
	return nil, false, nil
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
// everyone waiting on call. A walk the chain refuses (429) or cannot finish
// (a history too long to read) puts the key in a backoff of the grace: its
// last good answer is kept and nothing is asked of the chain until the
// backoff is over; a history too long to read keeps that answer indefinitely,
// and says so in the log.
func (c *CachedChecker) run(key, address string, call *walkCall) {
	c.mu.Lock()
	remembered := append([]licence.Mint(nil), c.mints[key]...)
	c.mu.Unlock()

	result, err := c.find(address, remembered)
	if err != nil {
		err = explain(key, err)
	}

	c.mu.Lock()
	switch {
	case err == nil:
		c.cache[key] = checkerEntry{collections: result.Collections, checkedAt: c.now()}
		if len(result.Mints) > 0 {
			c.mints[key] = result.Mints
		} else {
			delete(c.mints, key)
		}
		delete(c.backoffs, key)
	case isRateLimited(err):
		c.backoffs[key] = backoff{until: c.now().Add(c.grace), err: err}
	case isHistoryTooLong(err):
		c.backoffs[key] = backoff{until: c.now().Add(c.grace), err: err}
		if entry, ok := c.cache[key]; ok && !entry.kept {
			entry.kept = true
			c.cache[key] = entry
			log.Printf("licence of %s: %v; keeping the last answer until its history can be read", key, err)
		}
	}
	delete(c.inflight, key)
	c.mu.Unlock()
	if err == nil {
		c.save()
	}
	call.collections, call.err = result.Collections, err
	close(call.done)
}

func isRateLimited(err error) bool {
	var provider *chain.ProviderError
	return errors.As(err, &provider) && provider.Status == 429
}

func isHistoryTooLong(err error) bool {
	var tooLong *chain.HistoryTooLongError
	return errors.As(err, &tooLong)
}

// explain says in err which key's licence could not be checked and what to do
// about it, for the caller (a 502 body) and the log, wrapping err so its kind
// stays testable.
func explain(key string, err error) error {
	var tooLong *chain.HistoryTooLongError
	switch {
	case errors.As(err, &tooLong):
		return fmt.Errorf("cannot check the licence of key %s: %w; its history is too long to read, so set POSTERN_ISSUER_KEY on the backend and it reads only the issuer's history", key, err)
	case isRateLimited(err):
		return fmt.Errorf("cannot check the licence of key %s: %w; WhatsOnChain is rate-limiting this backend, try again in a few minutes", key, err)
	}
	return fmt.Errorf("cannot check the licence of key %s: %w", key, err)
}

// refreshInBackground runs refresh on its own goroutine, counted so Wait can
// wait for it.
func (c *CachedChecker) refreshInBackground(key, address string, call *walkCall) {
	c.background.Add(1)
	go func() {
		defer c.background.Done()
		c.refresh(key, address, call)
	}()
}

// Wait blocks until every background refresh started so far has finished,
// answers file written included. Production never needs it; a test that
// keeps answers in a temp directory calls it before the directory goes.
func (c *CachedChecker) Wait() {
	c.background.Wait()
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

// answersFile is what WithPersistence keeps: the answers, and the licence
// rule they were computed under.
type answersFile struct {
	Rule    string                     `json:"rule"`
	Answers map[string]persistedAnswer `json:"answers"`
}

type persistedAnswer struct {
	Collections []string       `json:"collections"`
	CheckedAt   time.Time      `json:"checkedAt"`
	Mints       []licence.Mint `json:"mints,omitempty"`
}

// ruleStamp names the licence rule an answer was computed under, so a
// restart with other collections or another issuer starts cold.
func (c *CachedChecker) ruleStamp() string {
	return fmt.Sprintf("%q|%s", c.rule.Collections, strings.ToLower(c.rule.IssuerKey))
}

// restore loads the answers an earlier life of the backend kept. A missing
// file is a first start; one that cannot be read, or was written under
// another rule, is logged (or not) and ignored.
func (c *CachedChecker) restore() {
	if c.persistPath == "" {
		return
	}
	raw, err := os.ReadFile(c.persistPath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("reading kept licence answers %s: %v", c.persistPath, err)
		}
		return
	}
	var file answersFile
	if err := json.Unmarshal(raw, &file); err != nil {
		log.Printf("kept licence answers %s are unreadable, starting cold: %v", c.persistPath, err)
		return
	}
	if file.Rule != c.ruleStamp() {
		log.Printf("kept licence answers %s were made under another licence rule, starting cold", c.persistPath)
		return
	}
	for key, answer := range file.Answers {
		c.cache[key] = checkerEntry{collections: answer.Collections, checkedAt: answer.CheckedAt, restored: true}
		if len(answer.Mints) > 0 {
			c.mints[key] = answer.Mints
		}
	}
}

// save writes every answer that names a collection to the answers file,
// whole or not at all. A failure is logged: the answers are still served
// from memory.
func (c *CachedChecker) save() {
	if c.persistPath == "" {
		return
	}
	c.persistMu.Lock()
	defer c.persistMu.Unlock()

	file := answersFile{Rule: c.ruleStamp(), Answers: map[string]persistedAnswer{}}
	c.mu.Lock()
	for key, entry := range c.cache {
		if len(entry.collections) > 0 {
			file.Answers[key] = persistedAnswer{Collections: entry.collections, CheckedAt: entry.checkedAt, Mints: c.mints[key]}
		}
	}
	c.mu.Unlock()

	if err := writeFileAtomic(c.persistPath, file); err != nil {
		log.Printf("keeping licence answers in %s failed: %v", c.persistPath, err)
	}
}

func writeFileAtomic(path string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".licence-answers-*")
	if err != nil {
		return err
	}
	_, werr := tmp.Write(raw)
	cerr := tmp.Close()
	if werr != nil || cerr != nil {
		os.Remove(tmp.Name())
		if werr != nil {
			return werr
		}
		return cerr
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	return nil
}
