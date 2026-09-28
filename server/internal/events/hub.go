// Package events is the event stream's hub (docs/protocol.md §10): every
// connected GET /api/events stream subscribes, and the hub fans each
// "message" (a record was indexed) and "view" (the view file changed) event
// out to all of them without ever waiting on one.
package events

import (
	"encoding/json"
	"sync"

	"github.com/Jonathan-A-White/postern/server/internal/index"
)

// DefaultBuffer is how many events a subscriber may fall behind before the
// hub disconnects it.
const DefaultBuffer = 64

// Event is one server-sent event: its name and its one-line JSON data.
type Event struct {
	Name string
	Data string
}

// Hub fans events out to every subscriber. Safe for concurrent use.
type Hub struct {
	buffer int

	mu   sync.Mutex
	subs map[chan Event]struct{}
}

// Option configures a Hub constructed by NewHub.
type Option func(*Hub)

// WithBuffer overrides DefaultBuffer.
func WithBuffer(n int) Option {
	return func(h *Hub) { h.buffer = n }
}

// NewHub builds a Hub with no subscribers.
func NewHub(opts ...Option) *Hub {
	h := &Hub{buffer: DefaultBuffer, subs: make(map[chan Event]struct{})}
	for _, opt := range opts {
		opt(h)
	}
	return h
}

// Subscribe registers a new subscriber and returns its event channel and a
// cancel function, which the stream must call when its client goes away.
// The channel is closed on cancel, or by the hub itself if the subscriber
// falls more than the buffer behind; cancel is safe to call either way, any
// number of times.
func (h *Hub) Subscribe() (<-chan Event, func()) {
	ch := make(chan Event, h.buffer)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()

	return ch, func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		h.dropLocked(ch)
	}
}

// Publish hands ev to every subscriber without blocking. A subscriber whose
// buffer is full is disconnected (its channel closed) rather than skipped:
// a skipped event would be lost silently, while a closed stream makes the
// client reconnect, read a fresh hello and re-sync.
func (h *Hub) Publish(ev Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- ev:
		default:
			h.dropLocked(ch)
		}
	}
}

// Subscribers reports how many subscribers are connected.
func (h *Hub) Subscribers() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subs)
}

// RecordIndexed publishes a "message" event naming rec's sequence number.
// It makes *Hub a notify.Notifier.
func (h *Hub) RecordIndexed(rec index.Record) {
	h.Publish(Event{Name: "message", Data: marshal(struct {
		Seq uint64 `json:"seq"`
	}{rec.Seq})})
}

// ViewChanged publishes a "view" event naming the view's new ETag (the
// exact ETag header value GET /api/view answers, quotes included).
func (h *Hub) ViewChanged(etag string) {
	h.Publish(Event{Name: "view", Data: marshal(struct {
		ETag string `json:"etag"`
	}{etag})})
}

// dropLocked removes and closes ch if it is still subscribed. Callers must
// hold h.mu.
func (h *Hub) dropLocked(ch chan Event) {
	if _, ok := h.subs[ch]; ok {
		delete(h.subs, ch)
		close(ch)
	}
}

func marshal(v any) string {
	data, _ := json.Marshal(v) // plain structs of strings and numbers never fail
	return string(data)
}
