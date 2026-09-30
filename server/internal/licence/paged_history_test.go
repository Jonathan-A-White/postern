package licence

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/woc"
)

// A holder who sends every message as a chain transaction soon has more
// than one page of history: its mint must still be found on the oldest.
func TestHeldForAMintOnTheThirdPageOfWhatsOnChainsHistory(t *testing.T) {
	holder := newTestKey(t)
	address := addressOf(holder)
	mint := contractMint(holder, "postern", address)

	// 207 confirmed transactions, the mint the oldest: pages of 100, 100
	// and 7, the newest page first and each page in ascending height.
	txids := []string{mint.txid}
	for h := 2; h <= 207; h++ {
		txids = append(txids, fmt.Sprintf("%064x", h))
	}
	pages := [][]string{txids[107:207], txids[7:107], txids[0:7]}
	heights := map[string]int{}
	for i, txid := range txids {
		heights[txid] = 1000 + i
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/tx/"+mint.txid+"/hex":
			w.Write([]byte(mint.hex))
		case strings.HasPrefix(r.URL.Path, "/tx/"):
			w.Write([]byte("00")) // a message transaction the rule reads no record from
		case r.URL.Path == "/address/"+address+"/unconfirmed/history":
			w.Write([]byte(`{"address":"` + address + `","result":[],"error":""}`))
		case r.URL.Path == "/address/"+address+"/confirmed/history":
			page := 0
			fmt.Sscanf(r.URL.Query().Get("token"), "page-%d", &page)
			var result []map[string]any
			for _, txid := range pages[page] {
				result = append(result, map[string]any{"tx_hash": txid, "height": heights[txid]})
			}
			reply := map[string]any{"address": address, "result": result, "error": ""}
			if page+1 < len(pages) {
				reply["nextPageToken"] = fmt.Sprintf("page-%d", page+1)
			}
			json.NewEncoder(w).Encode(reply)
		default:
			t.Errorf("unexpected path %q", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	client := woc.NewClient(server.URL, woc.WithMinSpacing(0), woc.WithSleep(func(time.Duration) {}))

	if !mustHeld(t, client, address, Rule{}) {
		t.Fatal("held = false, want true for a mint on the third page of history")
	}
}
