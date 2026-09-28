package api

import (
	"errors"
	"net/http"

	"github.com/Jonathan-A-White/postern/server/internal/beads"
)

// handleBead answers one bead's detail (docs/protocol.md §12): the bead
// command's stdout as text/plain; 400 for a malformed id, 501 with no
// command configured, 404 when the command says there is no such bead, and
// 502 for any other failure, including no answer within 30 seconds.
func handleBead(fetcher *beads.Fetcher) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		detail, err := fetcher.Get(r.Context(), r.PathValue("id"))
		switch {
		case errors.Is(err, beads.ErrInvalidID):
			writeError(w, http.StatusBadRequest, err.Error())
		case errors.Is(err, beads.ErrNotConfigured):
			writeError(w, http.StatusNotImplemented, err.Error())
		case errors.Is(err, beads.ErrNotFound):
			writeError(w, http.StatusNotFound, err.Error())
		case err != nil: // a *beads.CommandError
			writeError(w, http.StatusBadGateway, err.Error())
		default:
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusOK)
			w.Write(detail)
		}
	}
}
