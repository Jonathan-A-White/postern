package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/Jonathan-A-White/postern/server/internal/view"
)

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
