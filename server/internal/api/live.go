package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/events"
	"github.com/Jonathan-A-White/postern/server/internal/index"
	"github.com/Jonathan-A-White/postern/server/internal/record"
	"github.com/Jonathan-A-White/postern/server/internal/view"
)

// handleEvents streams docs/protocol.md §10's events: a hello naming the
// index head and the view's ETag, then every message and view event hub
// publishes, and a ": ping" comment every ping, each flushed as it is
// written. The subscription is taken before the hello is built, so nothing
// indexed in between is missed; it is dropped when the client goes (the
// request's context ends) or the hub drops a subscriber that fell behind. While
// it is open its key counts as present, and for PRESENCE_GRACE after (presence).
//
// An app's key that is neither a cockpit key nor the Mayor's gets the narrowed
// stream (§19): a hello naming only the head, which its own GET /api/messages
// already answers as next, and only the message events whose record it may page
// there (readableBy); never the view, nor any other event. Its stream does not
// count as presence. The mill's key gets the same, and of its records only the
// grist ones.
func handleEvents(store *index.Store, hub *events.Hub, v *view.File, ping time.Duration, here *presence) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			writeError(w, http.StatusInternalServerError, "streaming is not supported")
			return
		}
		key := AuthenticatedKey(r.Context())
		granted := rightsOf(r.Context())
		narrowed := !granted.cockpit && !granted.mayor

		ch, cancel := hub.Subscribe()
		defer cancel()
		if !narrowed {
			defer here.opened(key)()
		}

		header := w.Header()
		header.Set("Content-Type", "text/event-stream")
		header.Set("Cache-Control", "no-store")
		header.Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)

		var hello []byte
		if narrowed {
			hello, _ = json.Marshal(struct {
				Head uint64 `json:"head"`
			}{Head: store.Head()})
		} else {
			hello, _ = json.Marshal(struct {
				Head uint64 `json:"head"`
				View string `json:"view"`
			}{Head: store.Head(), View: v.ETag()})
		}
		if writeSSE(w, events.Event{Name: "hello", Data: string(hello)}) != nil {
			return
		}
		flusher.Flush()

		ticker := time.NewTicker(ping)
		defer ticker.Stop()
		for {
			var err error
			select {
			case <-r.Context().Done():
				return
			case ev, open := <-ch:
				if !open {
					return
				}
				if narrowed && !readableBy(store, key, granted.mill, ev) {
					continue
				}
				err = writeSSE(w, ev)
			case <-ticker.C:
				_, err = io.WriteString(w, ": ping\n\n")
			}
			if err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// readableBy reports whether a narrowed stream carries ev: only a message
// event naming a record the index holds and key may page from GET
// /api/messages (ownRecords: its envelope names key as to or from). The
// mill's stream (mill) carries only such a record of class grist, so it never
// hears a direct message. Every other event, an event name added later
// included, stays off it.
func readableBy(store *index.Store, key string, mill bool, ev events.Event) bool {
	if ev.Name != "message" {
		return false
	}
	var msg struct {
		Seq uint64 `json:"seq"`
	}
	if json.Unmarshal([]byte(ev.Data), &msg) != nil || msg.Seq == 0 {
		return false
	}
	page, _, _ := store.SinceLimit(msg.Seq-1, 1)
	if len(page) != 1 || page[0].Seq != msg.Seq || len(ownRecords(page, key)) != 1 {
		return false
	}
	if !mill {
		return true
	}
	env, err := record.ParseEnvelope(page[0].Payload)
	return err == nil && env.Class == record.ClassGrist
}

// writeSSE writes one named event with its one-line data.
func writeSSE(w io.Writer, ev events.Event) error {
	_, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Name, ev.Data)
	return err
}

// handleView serves the live view file (docs/protocol.md §11) as text/plain
// with its ETag and Cache-Control: no-store; 304 when If-None-Match already
// names the current ETag; 404 when no view is configured or written.
func handleView(v *view.File) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		data, etag, err := v.Read()
		if err != nil {
			if errors.Is(err, view.ErrNoView) {
				writeError(w, http.StatusNotFound, view.ErrNoView.Error())
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		w.Header().Set("ETag", etag)
		w.Header().Set("Cache-Control", "no-store")
		if ifNoneMatch(r.Header.Get("If-None-Match"), etag) {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		w.Write(data)
	}
}

// ifNoneMatch reports whether an If-None-Match header value names etag:
// any entry of its comma-separated list, weak (W/) or not, or "*".
func ifNoneMatch(header, etag string) bool {
	for _, candidate := range strings.Split(header, ",") {
		candidate = strings.TrimPrefix(strings.TrimSpace(candidate), "W/")
		if candidate == etag || candidate == "*" {
			return true
		}
	}
	return false
}
