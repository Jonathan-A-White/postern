package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/prompts"
)

// maxPromptBodyBytes caps a PUT /api/prompts/{name} body.
const maxPromptBodyBytes = 256 * 1024

// handlePromptList answers GET /api/prompts: every saved prompt as a JSON
// array sorted by name, with an ETag over that array so an If-None-Match that
// matches is a 304 and the app's refetch costs no body.
func handlePromptList(store *prompts.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if store == nil {
			writeError(w, http.StatusNotImplemented, "this backend keeps no prompts")
			return
		}
		data, err := json.Marshal(store.List())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		sum := sha256.Sum256(data)
		etag := `"` + hex.EncodeToString(sum[:16]) + `"`
		w.Header().Set("ETag", etag)
		w.Header().Set("Cache-Control", "no-cache")
		if ifNoneMatch(r.Header.Get("If-None-Match"), etag) {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(append(data, '\n'))
	}
}

// handlePromptGet answers GET /api/prompts/{name}: the prompt, or 404.
func handlePromptGet(store *prompts.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if store == nil {
			writeError(w, http.StatusNotImplemented, "this backend keeps no prompts")
			return
		}
		p, ok := store.Get(r.PathValue("name"))
		if !ok {
			writeError(w, http.StatusNotFound, "no such prompt")
			return
		}
		if p.Signature == nil {
			p.Signature = []prompts.Option{}
		}
		writeJSON(w, http.StatusOK, p)
	}
}

// handlePromptPut answers PUT /api/prompts/{name}: the whole prompt as JSON
// replaces any of that name. The name comes from the path (a body that names
// another is a 400); the server stamps updatedAt and updatedBy, whatever the
// body says. A bad name, flag, type or default is a 400 with a one-line reason.
func handlePromptPut(store *prompts.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if store == nil {
			writeError(w, http.StatusNotImplemented, "this backend keeps no prompts")
			return
		}
		name := r.PathValue("name")
		if !prompts.ValidName(name) {
			writeError(w, http.StatusBadRequest, "name must be 1 to 32 characters of a-z, 0-9 and -")
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxPromptBodyBytes))
		if err != nil {
			var maxErr *http.MaxBytesError
			if errors.As(err, &maxErr) {
				writeError(w, http.StatusRequestEntityTooLarge, "body exceeds 256 KiB")
				return
			}
			writeError(w, http.StatusBadRequest, "reading body: "+err.Error())
			return
		}
		var p prompts.Prompt
		if err := json.Unmarshal(body, &p); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		if p.Name != "" && p.Name != name {
			writeError(w, http.StatusBadRequest, "the body names a different prompt than the path")
			return
		}
		p.Name = name
		if p.Signature == nil {
			p.Signature = []prompts.Option{}
		}
		if err := p.Validate(); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		p.UpdatedAt = time.Now().UTC().Truncate(time.Second)
		p.UpdatedBy = AuthenticatedKey(r.Context())
		if err := store.Put(p); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, p)
	}
}

// handlePromptDelete answers DELETE /api/prompts/{name}: 204, or 404 when
// there was no such prompt.
func handlePromptDelete(store *prompts.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if store == nil {
			writeError(w, http.StatusNotImplemented, "this backend keeps no prompts")
			return
		}
		existed, err := store.Delete(r.PathValue("name"))
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !existed {
			writeError(w, http.StatusNotFound, "no such prompt")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
