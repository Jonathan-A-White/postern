// Package api wires up postern's HTTP surface: the message index and a
// thin proxy in front of WhatsOnChain for broadcasting and building
// transactions.
package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/Jonathan-A-White/postern/server/internal/auth"
	"github.com/Jonathan-A-White/postern/server/internal/index"
	"github.com/Jonathan-A-White/postern/server/internal/push"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
	webpush "github.com/SherClockHolmes/webpush-go"
)

// webpushSubscription mirrors the browser's PushSubscription.toJSON() shape,
// the body POST /api/push/subscribe expects under "subscription".
type webpushSubscription struct {
	Endpoint string       `json:"endpoint"`
	Keys     webpush.Keys `json:"keys"`
}

const (
	maxBroadcastBodyBytes = 1 << 20 // 1 MiB, generous for a rawtx hex string
	maxSubscribeBodyBytes = 1 << 16 // 64 KiB, generous for a PushSubscription
)

// NewHandler builds the full /api/* surface (plus /healthz) backed by store
// and client. vapidPublicKey is handed to GET /api/push/vapid-public-key;
// pushStore backs POST /api/push/subscribe. Every /api endpoint except
// GET /api/challenge requires a signed, licensed proof (requireLicence),
// checked against nonces and checker.
func NewHandler(store *index.Store, client *woc.Client, vapidPublicKey string, pushStore *push.Store, nonces *auth.NonceStore, checker auth.LicenceChecker) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", handleHealthz)
	mux.HandleFunc("GET /api/challenge", handleChallenge(nonces))
	mux.HandleFunc("GET /api/messages", requireLicence(nonces, checker, handleMessages(store)))
	mux.HandleFunc("POST /api/broadcast", requireLicence(nonces, checker, handleBroadcast(client)))
	mux.HandleFunc("GET /api/utxos/{address}", requireLicence(nonces, checker, handleUtxos(client)))
	mux.HandleFunc("GET /api/balance/{address}", requireLicence(nonces, checker, handleBalance(client)))
	mux.HandleFunc("GET /api/push/vapid-public-key", requireLicence(nonces, checker, handleVAPIDPublicKey(vapidPublicKey)))
	mux.HandleFunc("POST /api/push/subscribe", requireLicence(nonces, checker, handlePushSubscribe(pushStore)))
	return mux
}

// authScheme is the Authorization header's scheme token: "Postern
// <pubkeyHex>:<nonceHex>:<sigHex>", where sigHex is a DER-encoded ECDSA
// signature by the compressed secp256k1 key pubkeyHex over the nonce
// (docs/api.md).
const authScheme = "Postern "

// parseAuthorization splits a "Postern <pubkeyHex>:<nonceHex>:<sigHex>"
// Authorization header into its three parts, reporting ok=false for
// anything else, including any empty part.
func parseAuthorization(header string) (pubKeyHex, nonce, sigHex string, ok bool) {
	if !strings.HasPrefix(header, authScheme) {
		return "", "", "", false
	}
	parts := strings.Split(strings.TrimPrefix(header, authScheme), ":")
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return "", "", "", false
	}
	return parts[0], parts[1], parts[2], true
}

// requireLicence wraps next so it only runs once the request's Authorization
// header proves a signed, licensed key: the header must carry a nonce this
// nonces store issued and hasn't already consumed, a valid signature over
// that nonce by the named public key, and that key must hold a licence per
// checker. Anything short of that is a 401; a failure to check the licence
// itself (a chain read failing) is a 502, like this backend's other
// provider-proxy failures.
func requireLicence(nonces *auth.NonceStore, checker auth.LicenceChecker, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pubKeyHex, nonce, sigHex, ok := parseAuthorization(r.Header.Get("Authorization"))
		if !ok {
			writeError(w, http.StatusUnauthorized, "missing or malformed Authorization header")
			return
		}
		if !nonces.Consume(nonce) {
			writeError(w, http.StatusUnauthorized, "nonce is missing, expired, or already used")
			return
		}
		valid, err := auth.VerifySignature(pubKeyHex, nonce, sigHex)
		if err != nil || !valid {
			writeError(w, http.StatusUnauthorized, "signature does not verify")
			return
		}
		held, err := checker.Held(pubKeyHex)
		if err != nil {
			writeError(w, http.StatusBadGateway, "checking licence: "+err.Error())
			return
		}
		if !held {
			writeError(w, http.StatusUnauthorized, "no licence held")
			return
		}
		next(w, r)
	}
}

func handleChallenge(nonces *auth.NonceStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		nonce, err := nonces.Issue()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, struct {
			Nonce string `json:"nonce"`
		}{Nonce: nonce})
	}
}

func handleHealthz(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("ok"))
}

func handleMessages(store *index.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sinceParam := r.URL.Query().Get("since")
		var since uint64
		if sinceParam != "" {
			parsed, err := strconv.ParseUint(sinceParam, 10, 64)
			if err != nil {
				writeError(w, http.StatusBadRequest, "since must be a non-negative integer")
				return
			}
			since = parsed
		}

		records, next := store.Since(since)
		writeJSON(w, http.StatusOK, struct {
			Records []index.Record `json:"records"`
			Next    uint64         `json:"next"`
		}{Records: records, Next: next})
	}
}

func handleBroadcast(client *woc.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			RawTx string `json:"rawtx"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, maxBroadcastBodyBytes)).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		if req.RawTx == "" {
			writeError(w, http.StatusBadRequest, "rawtx is required")
			return
		}

		txid, err := client.Broadcast(req.RawTx)
		if err != nil {
			writeProviderError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, struct {
			TxID string `json:"txid"`
		}{TxID: txid})
	}
}

func handleUtxos(client *woc.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		address := r.PathValue("address")
		utxos, err := client.GetUtxos(address)
		if err != nil {
			writeProviderError(w, err)
			return
		}

		type utxo struct {
			TxID     string `json:"txid"`
			Vout     int    `json:"vout"`
			Satoshis int64  `json:"satoshis"`
			Height   int    `json:"height"`
		}
		out := make([]utxo, len(utxos))
		for i, u := range utxos {
			out[i] = utxo{TxID: u.TxHash, Vout: u.TxPos, Satoshis: u.Value, Height: u.Height}
		}

		writeJSON(w, http.StatusOK, struct {
			Utxos []utxo `json:"utxos"`
		}{Utxos: out})
	}
}

func handleBalance(client *woc.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		address := r.PathValue("address")
		balance, err := client.GetBalance(address)
		if err != nil {
			writeProviderError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, balance)
	}
}

func handleVAPIDPublicKey(publicKey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, struct {
			PublicKey string `json:"publicKey"`
		}{PublicKey: publicKey})
	}
}

func handlePushSubscribe(store *push.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			PublicKeyHex string              `json:"pubkey"`
			Subscription webpushSubscription `json:"subscription"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, maxSubscribeBodyBytes)).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		if req.PublicKeyHex == "" {
			writeError(w, http.StatusBadRequest, "pubkey is required")
			return
		}
		if req.Subscription.Endpoint == "" {
			writeError(w, http.StatusBadRequest, "subscription.endpoint is required")
			return
		}

		sub := push.Subscription{
			PublicKeyHex: req.PublicKeyHex,
			Endpoint:     req.Subscription.Endpoint,
			Keys:         req.Subscription.Keys,
		}
		if err := store.Add(sub); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, struct{}{})
	}
}

// writeProviderError maps a woc.Client error to an HTTP response: a
// *woc.APIError becomes a 502 naming the provider's own status and body, and
// anything else (a network failure, an unreachable provider) becomes a
// generic 502 too — from this backend's caller's perspective both are just
// "the provider proxy failed."
func writeProviderError(w http.ResponseWriter, err error) {
	var apiErr *woc.APIError
	if errors.As(err, &apiErr) {
		writeError(w, http.StatusBadGateway, apiErr.Error())
		return
	}
	writeError(w, http.StatusBadGateway, err.Error())
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, struct {
		Error string `json:"error"`
	}{Error: message})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}
