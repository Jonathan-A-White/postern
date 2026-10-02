package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"
)

// PRESENCE_GRACE is how long the Mayor still counts as here after his key's
// last stream closed. His `mw talk wait` ends on every turn and is armed again
// a moment later, so the gap between two waits is not him going away.
const PRESENCE_GRACE = 120 * time.Second

// presence counts the event streams each key holds open and remembers when each
// key's last one closed. The Mayor is here while his key holds at least one, or
// closed its last less than PRESENCE_GRACE ago (docs/protocol.md §20): `mw talk
// wait` holds one for as long as it waits.
type presence struct {
	mu     sync.Mutex
	now    func() time.Time
	open   map[string]int
	closed map[string]time.Time // when the key's last open stream closed
}

func newPresence() *presence {
	return &presence{now: time.Now, open: make(map[string]int), closed: make(map[string]time.Time)}
}

// opened records a stream opened by key and returns what closes it again;
// calling that more than once does nothing more.
func (p *presence) opened(key string) (closed func()) {
	key = strings.ToLower(key)
	p.mu.Lock()
	p.open[key]++
	p.mu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			p.mu.Lock()
			defer p.mu.Unlock()
			if p.open[key]--; p.open[key] <= 0 {
				delete(p.open, key)
				p.closed[key] = p.now()
			}
		})
	}
}

// here reports whether key holds a stream open or closed its last one less than
// PRESENCE_GRACE ago; an empty key never does.
func (p *presence) here(key string) bool {
	if key == "" {
		return false
	}
	key = strings.ToLower(key)
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.open[key] > 0 {
		return true
	}
	at, ok := p.closed[key]
	if !ok {
		return false
	}
	if p.now().Sub(at) < PRESENCE_GRACE {
		return true
	}
	delete(p.closed, key)
	return false
}

// handlePresence answers GET /api/presence: {"mayor": true} while the Mayor's
// key holds the event stream open or closed it less than PRESENCE_GRACE ago.
func handlePresence(p *presence, mayorKey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(struct {
			Mayor bool `json:"mayor"`
		}{p.here(mayorKey)})
	}
}
