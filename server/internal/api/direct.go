package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
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
// answers 200 with the stored record rather than indexing it twice. A post may
// also carry a "clientId" (the phone's outbox row's id): a repeat of an id this
// key sent within 24 hours is answered 200 with the first acceptance's txid and
// seq, whatever bytes the retry carries, so a lost reply never makes a second
// record. A newly stored record goes to notifier, the same fan-out the poller uses.
//
// A key that is not a cockpit key sends grist only, and an app's key sends
// it to millKey only (403 otherwise); a record is stamped with the apps its
// signer's licences open, which is what the mill trusts (docs/protocol.md
// §19).
func handleDirectMessage(store *index.Store, notifier notify.Notifier, millKey string) http.HandlerFunc {
	seen := newClientIDs(time.Now)
	// accepting makes "have I taken this client id" and "take it" one step, so two tries of one send at once store it once.
	var accepting sync.Mutex
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
			ClientID  string `json:"clientId"`
		}
		if err := json.Unmarshal(body, &req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		if req.ScriptHex == "" {
			writeError(w, http.StatusBadRequest, "scriptHex is required")
			return
		}
		if req.ClientID != "" && !validClientID(req.ClientID) {
			writeError(w, http.StatusBadRequest, "clientId must be 1 to 128 letters, digits, '-' or '_'")
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
		granted := rightsOf(r.Context())
		if !granted.cockpit {
			if envelope.Class != record.ClassGrist {
				writeError(w, http.StatusForbidden, "this key may send only grist")
				return
			}
			if !granted.mill && !strings.EqualFold(envelope.To, millKey) {
				writeError(w, http.StatusForbidden, "an app's grist goes to the mill only")
				return
			}
		}

		if req.ClientID != "" {
			accepting.Lock()
			defer accepting.Unlock()
			if first, ok := seen.lookup(signer, req.ClientID); ok {
				writeJSON(w, http.StatusOK, struct {
					TxID string `json:"txid"`
					Seq  uint64 `json:"seq"`
				}{TxID: first.txid, Seq: first.seq})
				return
			}
		}

		sum := sha256.Sum256(script)
		stored, created, err := store.AppendDirect(index.Record{
			TxID:       DirectPrefix + hex.EncodeToString(sum[:]),
			Vout:       0,
			ScriptHex:  scriptHex,
			Height:     0,
			FirstSeen:  time.Now().UTC(),
			Payload:    decoded.Payload,
			Signer:     signer,
			SignerApps: granted.apps,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		if req.ClientID != "" {
			seen.remember(signer, req.ClientID, stored.TxID, stored.Seq)
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
