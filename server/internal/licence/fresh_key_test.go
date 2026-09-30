package licence

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/woc"
)

// A contract mint pays nothing to the holder's address, so a key the issuer
// licenses has no history of its own: WhatsOnChain answers 404 for its
// /confirmed/history. The door must read that as "no history", find the mint
// in the issuer's history, and never fail with a chain error.
func freshKeyChain(t *testing.T, issuerAddress string, issuerTxs []testTx) *woc.Client {
	t.Helper()
	txHex := map[string]string{}
	for _, tx := range issuerTxs {
		txHex[tx.txid] = tx.hex
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		switch {
		case path == "/address/"+issuerAddress+"/confirmed/history":
			result := []map[string]any{}
			for i, tx := range issuerTxs {
				result = append(result, map[string]any{"tx_hash": tx.txid, "height": 100 + i})
			}
			json.NewEncoder(w).Encode(map[string]any{"address": issuerAddress, "result": result, "error": ""})
		case strings.HasSuffix(path, "/confirmed/history"): // any other address: never seen
			http.Error(w, "Not Found", http.StatusNotFound)
		case strings.HasSuffix(path, "/unconfirmed/history"):
			w.Write([]byte(`{"result":[],"error":""}`))
		case strings.HasPrefix(path, "/tx/") && strings.HasSuffix(path, "/hex"):
			id := strings.TrimSuffix(strings.TrimPrefix(path, "/tx/"), "/hex")
			if raw, ok := txHex[id]; ok {
				w.Write([]byte(raw))
				return
			}
			http.Error(w, "Not Found", http.StatusNotFound)
		default:
			t.Errorf("unexpected path %q", path)
			w.WriteHeader(http.StatusTeapot)
		}
	}))
	t.Cleanup(server.Close)
	return woc.NewClient(server.URL, woc.WithMinSpacing(0), woc.WithSleep(func(time.Duration) {}))
}

func TestHeldForAKeyWithNoHistoryOfItsOwnWhoseMintIsInTheIssuersHistory(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	mint := contractMint(issuer, "postern", addressOf(holder))
	client := freshKeyChain(t, addressOf(issuer), []testTx{mint})

	if !mustHeld(t, client, addressOf(holder), Rule{IssuerKey: pubHex(issuer)}) {
		t.Fatal("held = false, want true for a fresh key the issuer minted for")
	}
}

func TestHeldFalseNotAChainErrorForAKeyWithNoHistoryAndNoMint(t *testing.T) {
	issuer, holder, other := newTestKey(t), newTestKey(t), newTestKey(t)
	mint := contractMint(issuer, "postern", addressOf(other)) // minted for someone else
	client := freshKeyChain(t, addressOf(issuer), []testTx{mint})

	if mustHeld(t, client, addressOf(holder), Rule{IssuerKey: pubHex(issuer)}) {
		t.Fatal("held = true, want false for a fresh key nobody minted for")
	}
}
