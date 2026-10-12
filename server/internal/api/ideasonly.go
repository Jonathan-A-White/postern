package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/ideasonly"
)

// maxIdeasOnlyBodyBytes caps a PUT /api/ideas-only/{pubkey} body.
const maxIdeasOnlyBodyBytes = 16 * 1024

var pubKeyPattern = regexp.MustCompile(`^(02|03)[0-9a-f]{64}$`)

// ideasOnlyBody is what GET and PUT /api/ideas-only/{pubkey} answer: the
// stored setting and the state worked out from it now (docs/protocol.md §25).
type ideasOnlyBody struct {
	Setting ideasonly.Setting `json:"setting"`
	State   ideasonly.Status  `json:"state"`
}

// ideasOnlyKey is the lower-cased key the path names, or "" after writing a
// 400 that says it is no compressed public key.
func ideasOnlyKey(w http.ResponseWriter, r *http.Request) string {
	key := strings.ToLower(r.PathValue("pubkey"))
	if !pubKeyPattern.MatchString(key) {
		writeError(w, http.StatusBadRequest, "the path must name a compressed public key in hex")
		return ""
	}
	return key
}

// handleIdeasOnlyGet answers GET /api/ideas-only/{pubkey}: the key's setting
// (empty when none was stored) and its state now.
func handleIdeasOnlyGet(store *ideasonly.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if store == nil {
			writeError(w, http.StatusNotImplemented, "this backend keeps no Ideas only settings")
			return
		}
		key := ideasOnlyKey(w, r)
		if key == "" {
			return
		}
		setting, state := store.Get(key)
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, ideasOnlyBody{Setting: setting, State: state})
	}
}

// handleIdeasOnlyPut answers PUT /api/ideas-only/{pubkey}: the whole setting as
// JSON replaces the key's. Only that very key may write it (403); a bad time
// zone, day, time or window is a 400 with a one-line reason; over 16 KiB is a
// 413. The server stamps updatedAt and updatedBy, whatever the body says.
func handleIdeasOnlyPut(store *ideasonly.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if store == nil {
			writeError(w, http.StatusNotImplemented, "this backend keeps no Ideas only settings")
			return
		}
		key := ideasOnlyKey(w, r)
		if key == "" {
			return
		}
		caller := AuthenticatedKey(r.Context())
		if caller != key {
			writeError(w, http.StatusForbidden, "only a key may set its own Ideas only")
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxIdeasOnlyBodyBytes))
		if err != nil {
			var maxErr *http.MaxBytesError
			if errors.As(err, &maxErr) {
				writeError(w, http.StatusRequestEntityTooLarge, "body exceeds 16 KiB")
				return
			}
			writeError(w, http.StatusBadRequest, "reading body: "+err.Error())
			return
		}
		var setting ideasonly.Setting
		if err := json.Unmarshal(body, &setting); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		if err := setting.Validate(); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		at := time.Now().UTC().Truncate(time.Second)
		setting.UpdatedAt, setting.UpdatedBy = &at, caller
		state, err := store.Put(key, setting)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, ideasOnlyBody{Setting: setting, State: state})
	}
}
