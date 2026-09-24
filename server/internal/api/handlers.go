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

	"github.com/Jonathan-A-White/postern/server/internal/index"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
)

const maxBroadcastBodyBytes = 1 << 20 // 1 MiB, generous for a rawtx hex string

// NewHandler builds the full /api/* surface (plus /healthz) backed by store
// and client.
func NewHandler(store *index.Store, client *woc.Client) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", handleHealthz)
	mux.HandleFunc("GET /api/messages", handleMessages(store))
	mux.HandleFunc("POST /api/broadcast", handleBroadcast(client))
	mux.HandleFunc("GET /api/utxos/{address}", handleUtxos(client))
	mux.HandleFunc("GET /api/balance/{address}", handleBalance(client))
	return mux
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
