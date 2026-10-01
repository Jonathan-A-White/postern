package api

import (
	"sync"
	"time"
)

const (
	// clientIDWindow is how long a client id is remembered (docs/protocol.md §9).
	clientIDWindow = 24 * time.Hour
	// clientIDLimit bounds how many ids are held at once; the oldest go first.
	clientIDLimit = 20000
	// maxClientIDLen caps a client id's length.
	maxClientIDLen = 128
)

// acceptance is what the backend answered the first time it took a client id.
type acceptance struct {
	txid string
	seq  uint64
	at   time.Time
}

// clientIDs remembers, per signing key, the client ids of recently accepted
// direct messages, so a phone that never heard the reply and sends the post
// again (freshly encrypted, so other bytes) is answered with the first
// acceptance rather than storing a second record. It lives in memory: a
// restart forgets it, which only reopens a window the size of one lost reply.
type clientIDs struct {
	mu    sync.Mutex
	now   func() time.Time
	byKey map[string]acceptance
	order []string
}

func newClientIDs(now func() time.Time) *clientIDs {
	return &clientIDs{now: now, byKey: map[string]acceptance{}}
}

func clientIDKey(signer, id string) string { return signer + "|" + id }

// validClientID is 1 to maxClientIDLen letters, digits, '-' or '_'.
func validClientID(id string) bool {
	if id == "" || len(id) > maxClientIDLen {
		return false
	}
	for _, c := range id {
		switch {
		case c >= '0' && c <= '9', c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c == '-', c == '_':
		default:
			return false
		}
	}
	return true
}

// lookup returns the first acceptance of id from signer, if it is still within its window.
func (c *clientIDs) lookup(signer, id string) (acceptance, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	got, ok := c.byKey[clientIDKey(signer, id)]
	if ok && c.now().Sub(got.at) > clientIDWindow {
		return acceptance{}, false
	}
	return got, ok
}

// remember records the acceptance of id from signer, dropping what is past its window or over the limit.
func (c *clientIDs) remember(signer, id, txid string, seq uint64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	key := clientIDKey(signer, id)
	if _, ok := c.byKey[key]; !ok {
		c.order = append(c.order, key)
	}
	c.byKey[key] = acceptance{txid: txid, seq: seq, at: now}
	// order is oldest first, so what is past its window or over the limit is at the front.
	drop := 0
	for drop < len(c.order) && (len(c.order)-drop > clientIDLimit || now.Sub(c.byKey[c.order[drop]].at) > clientIDWindow) {
		delete(c.byKey, c.order[drop])
		drop++
	}
	c.order = c.order[drop:]
}

func (c *clientIDs) size() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.byKey)
}
