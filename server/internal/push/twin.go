package push

import (
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"sync"
	"time"
)

// The Mayor's `mw postern send` posts a message twice: direct, and on chain under a transaction id.
// The phone keeps one row per message (src/model/twins.ts sameMessage: ciphertext, from, to, ts) and
// never stores the chain copy once the direct row is held, so a push for the chain copy could not be
// opened and would be a second notification. The Sender therefore remembers the twin key of each
// message it pushed, and skips a later record with the same key, whichever copy came first.
const (
	twinMemoryTTL = 24 * time.Hour
	twinMemoryCap = 4096
)

// twinKey is the identity of a message across its direct and chain copies: to, from, ts and a hash of
// ct, the fields the app's sameMessage compares. A record with no ciphertext has no key ("") and is
// never treated as a twin.
func twinKey(a addressedPayload) string {
	if a.Ct == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(a.Ct))
	return a.To + "\x00" + a.From + "\x00" + strconv.FormatInt(a.Ts, 10) + "\x00" + hex.EncodeToString(sum[:])
}

// twinMemory is a bounded, expiring set of twin keys: an entry lives ttl, and at most cap are held
// (the oldest goes first).
type twinMemory struct {
	mu    sync.Mutex
	ttl   time.Duration
	cap   int
	now   func() time.Time
	at    map[string]time.Time
	order []string // keys, oldest first
}

func newTwinMemory(ttl time.Duration, cap int) *twinMemory {
	return &twinMemory{ttl: ttl, cap: cap, now: time.Now, at: map[string]time.Time{}}
}

// claim remembers key and reports true, or reports false when key is already remembered.
func (m *twinMemory) claim(key string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.expire()
	if _, ok := m.at[key]; ok {
		return false
	}
	m.at[key] = m.now()
	m.order = append(m.order, key)
	for len(m.order) > m.cap {
		delete(m.at, m.order[0])
		m.order = m.order[1:]
	}
	return true
}

// release forgets key, for a push that reached no device and so did not notify anyone.
func (m *twinMemory) release(key string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.at[key]; !ok {
		return
	}
	delete(m.at, key)
	for i, k := range m.order {
		if k == key {
			m.order = append(m.order[:i], m.order[i+1:]...)
			break
		}
	}
}

func (m *twinMemory) len() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.expire()
	return len(m.at)
}

// expire drops every key older than ttl; callers hold mu. order is oldest first, so it stops at the
// first key still fresh.
func (m *twinMemory) expire() {
	cutoff := m.now().Add(-m.ttl)
	for len(m.order) > 0 && !m.at[m.order[0]].After(cutoff) {
		delete(m.at, m.order[0])
		m.order = m.order[1:]
	}
}
