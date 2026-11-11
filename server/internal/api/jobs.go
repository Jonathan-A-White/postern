package api

import (
	"net/http"

	"github.com/Jonathan-A-White/postern/server/internal/jobs"
)

// WithJobs sets the store GET /api/jobs and GET /api/jobs/{id} read (docs/jobs.md).
// Without it those routes answer 501.
func WithJobs(store *jobs.Store) Option {
	return func(o *options) { o.jobs = store }
}

// handleJobList answers GET /api/jobs: {"jobs": [{id, title, updated, done, total}]}, newest updated first.
// A bad feed file is left out (and logged by the store), never a 500.
func handleJobList(store *jobs.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if store == nil {
			writeError(w, http.StatusNotImplemented, "this backend keeps no jobs")
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, struct {
			Jobs []jobs.Summary `json:"jobs"`
		}{Jobs: store.List()})
	}
}

// handleJobGet answers GET /api/jobs/{id}: the whole feed file, or 404.
func handleJobGet(store *jobs.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if store == nil {
			writeError(w, http.StatusNotImplemented, "this backend keeps no jobs")
			return
		}
		j, ok := store.Get(r.PathValue("id"))
		if !ok {
			writeError(w, http.StatusNotFound, "no such job")
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, j)
	}
}
