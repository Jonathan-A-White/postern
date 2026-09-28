package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/index"
	"github.com/Jonathan-A-White/postern/server/internal/notify"
	"github.com/Jonathan-A-White/postern/server/internal/record"
)

// maxDirectBodyBytes caps a POST /api/messages body (docs/protocol.md §9).
const maxDirectBodyBytes = 256 * 1024

// DirectPrefix starts every directly delivered record's txid: a real txid
// is 64 hex characters and never contains ':'.
const DirectPrefix = "direct:"

// handleDirectMessage indexes a §1 record script posted straight to the
// backend (docs/protocol.md §9): it must decode as an nftgate version-1
// record whose payload is §1's envelope (400 otherwise), sent from the very
// key that authenticated the request (403 otherwise). The record is named
// "direct:<sha256 hex of the script bytes>"; posting the same bytes again
// answers 200 with the stored record rather than indexing it twice. A newly
// stored record goes to notifier, the same fan-out the poller uses.
func handleDirectMessage(store *index.Store, notifier notify.Notifier) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxDirectBodyBytes))
		if err != nil {
			var maxErr *http.MaxBytesError
			if errors.As(err, &maxErr) {
				writeError(w, http.StatusRequestEntityTooLarge, "body exceeds 256 KiB")
				return
			}
			writeError(w, http.StatusBadRequest, "reading body: "+err.Error())
			return
		}

		var req struct {
			ScriptHex string `json:"scriptHex"`
		}
		if err := json.Unmarshal(body, &req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		if req.ScriptHex == "" {
			writeError(w, http.StatusBadRequest, "scriptHex is required")
			return
		}
		script, err := hex.DecodeString(req.ScriptHex)
		if err != nil {
			writeError(w, http.StatusBadRequest, "scriptHex is not hex")
			return
		}
		scriptHex := hex.EncodeToString(script)

		decoded, ok := record.DecodeScript(scriptHex)
		if !ok || decoded.Version != record.VersionPlaintext || decoded.Payload == nil {
			writeError(w, http.StatusBadRequest, "scriptHex is not an nftgate version-1 record with a JSON payload")
			return
		}
		envelope, err := record.ParseEnvelope(decoded.Payload)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}

		signer := AuthenticatedKey(r.Context())
		if !strings.EqualFold(envelope.From, signer) {
			writeError(w, http.StatusForbidden, "payload from is not the key that signed this request")
			return
		}

		sum := sha256.Sum256(script)
		stored, created, err := store.AppendDirect(index.Record{
			TxID:      DirectPrefix + hex.EncodeToString(sum[:]),
			Vout:      0,
			ScriptHex: scriptHex,
			Height:    0,
			FirstSeen: time.Now().UTC(),
			Payload:   decoded.Payload,
			Signer:    signer,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}
		writeJSON(w, status, struct {
			TxID string `json:"txid"`
			Seq  uint64 `json:"seq"`
		}{TxID: stored.TxID, Seq: stored.Seq})

		if created {
			notifier.RecordIndexed(stored)
		}
	}
}
