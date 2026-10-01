package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
)

// presence counts the event streams each key holds open. The Mayor is here
// while his key holds at least one (docs/protocol.md §20): `mw talk wait`
// holds one for as long as it waits, and has none between turns, as during a
// handoff.
type presence struct {
	mu   sync.Mutex
	open map[string]int
}

func newPresence() *presence { return &presence{open: make(map[string]int)} }

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
			}
		})
	}
}

// here reports whether key holds a stream open; an empty key never does.
func (p *presence) here(key string) bool {
	if key == "" {
		return false
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.open[strings.ToLower(key)] > 0
}

// handlePresence answers GET /api/presence: {"mayor": true} while the Mayor's
// key holds the event stream open.
func handlePresence(p *presence, mayorKey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(struct {
			Mayor bool `json:"mayor"`
		}{p.here(mayorKey)})
	}
}
