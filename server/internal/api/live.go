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
	"github.com/Jonathan-A-White/postern/server/internal/view"
)

// handleEvents streams docs/protocol.md §10's events: a hello naming the
// index head and the view's ETag, then every message and view event hub
// publishes, and a ": ping" comment every ping, each flushed as it is
// written. The subscription is taken before the hello is built, so nothing
// indexed in between is missed; it is dropped when the client goes (the
// request's context ends) or the hub drops a subscriber that fell behind. While
// it is open its key counts as present, and for PRESENCE_GRACE after (presence).
func handleEvents(store *index.Store, hub *events.Hub, v *view.File, ping time.Duration, here *presence) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			writeError(w, http.StatusInternalServerError, "streaming is not supported")
			return
		}

		ch, cancel := hub.Subscribe()
		defer cancel()
		defer here.opened(AuthenticatedKey(r.Context()))()

		header := w.Header()
		header.Set("Content-Type", "text/event-stream")
		header.Set("Cache-Control", "no-store")
		header.Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)

		hello, _ := json.Marshal(struct {
			Head uint64 `json:"head"`
			View string `json:"view"`
		}{Head: store.Head(), View: v.ETag()})
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
