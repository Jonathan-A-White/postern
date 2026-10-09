package woc

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/chain"
)

func newTestClient(t *testing.T, handler http.HandlerFunc) (*Client, *int32) {
	t.Helper()
	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		handler(w, r)
	}))
	t.Cleanup(server.Close)

	var slept []time.Duration
	client := NewClient(server.URL,
		WithMinSpacing(0),
		WithRetryDelay(time.Millisecond),
		WithSleep(func(d time.Duration) { slept = append(slept, d) }),
	)
	return client, &calls
}

// pagedHistory is a stub of WhatsOnChain's paged history routes for address:
// /confirmed/history serves pages (pages[0] the newest, each in ascending
// height), chained by nextPageToken, and /unconfirmed/history serves
// unconfirmed.
func pagedHistory(t *testing.T, address string, pages [][]string, heights map[string]int, unconfirmed []string) http.HandlerFunc {
	t.Helper()
	token := func(i int) string { return fmt.Sprintf("page+%d/token=", i) } // escaping matters
	return func(w http.ResponseWriter, r *http.Request) {
		entries := func(txids []string) []map[string]any {
			out := []map[string]any{}
			for _, txid := range txids {
				out = append(out, map[string]any{"tx_hash": txid, "height": heights[txid]})
			}
			return out
		}
		reply := map[string]any{"address": address, "script": "76a9", "error": ""}
		switch r.URL.Path {
		case "/address/" + address + "/unconfirmed/history":
			reply["result"] = entries(unconfirmed)
		case "/address/" + address + "/confirmed/history":
			page := 0
			if got := r.URL.Query().Get("token"); got != "" {
				page = -1
				for i := range pages {
					if token(i) == got {
						page = i
					}
				}
				if page < 0 {
					t.Errorf("unknown token %q", got)
					w.WriteHeader(http.StatusBadRequest)
					return
				}
			}
			reply["result"] = entries(pages[page])
			if page+1 < len(pages) {
				reply["nextPageToken"] = token(page + 1)
			}
		default:
			t.Errorf("unexpected path %q", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		json.NewEncoder(w).Encode(reply)
	}
}

func TestGetHistoryReadsEveryPageOldestFirstWithUnconfirmedLast(t *testing.T) {
	// 207 confirmed transactions at heights 1..207 in three pages of 100,
	// 100 and 7 (newest page first, each page ascending), and one unconfirmed.
	heights := map[string]int{}
	var all []string
	for h := 1; h <= 207; h++ {
		txid := fmt.Sprintf("tx%03d", h)
		heights[txid] = h
		all = append(all, txid)
	}
	pages := [][]string{all[107:207], all[7:107], all[0:7]}
	client, _ := newTestClient(t, pagedHistory(t, "mAnchor", pages, heights, []string{"mempool"}))

	history, err := client.GetHistory("mAnchor")
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if len(history) != 208 {
		t.Fatalf("len(history) = %d, want 208", len(history))
	}
	seen := map[string]bool{}
	for i, entry := range history[:207] {
		if entry.TxHash != all[i] || entry.Height != i+1 {
			t.Fatalf("history[%d] = %+v, want %s at height %d (oldest first)", i, entry, all[i], i+1)
		}
		seen[entry.TxHash] = true
	}
	if last := history[207]; last.TxHash != "mempool" || last.Height != 0 {
		t.Fatalf("history[207] = %+v, want the unconfirmed one last at height 0", last)
	}
	if seen["mempool"] || len(seen) != 207 {
		t.Fatalf("a tx_hash appears more than once")
	}
}

func TestGetHistoryListsATransactionOnceWhenItShowsInTwoReplies(t *testing.T) {
	// A transaction that confirms between the reads shows as both
	// unconfirmed and confirmed; a block landing between pages repeats an
	// entry across two of them.
	heights := map[string]int{"a": 1, "b": 2, "c": 3}
	pages := [][]string{{"b", "c"}, {"a", "b"}}
	client, _ := newTestClient(t, pagedHistory(t, "mAnchor", pages, heights, []string{"c", "d"}))

	history, err := client.GetHistory("mAnchor")
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	want := []HistoryEntry{{TxHash: "a", Height: 1}, {TxHash: "b", Height: 2}, {TxHash: "c", Height: 3}, {TxHash: "d", Height: 0}}
	if fmt.Sprint(history) != fmt.Sprint(want) {
		t.Fatalf("history = %+v, want %+v", history, want)
	}
}

func TestGetHistoryFailsPastThePageCapRatherThanReturningAShortList(t *testing.T) {
	client, calls := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/unconfirmed/history") {
			w.Write([]byte(`{"address":"mEndless","result":[],"error":""}`))
			return
		}
		n := len(r.URL.Query().Get("token"))
		w.Write([]byte(fmt.Sprintf(`{"address":"mEndless","result":[{"tx_hash":"tx%d","height":%d}],"nextPageToken":"%s","error":""}`,
			n, 1000-n, strings.Repeat("x", n+1))))
	})

	history, err := client.GetHistory("mEndless")
	if err == nil {
		t.Fatalf("GetHistory returned %d entries and no error, want an error past the cap", len(history))
	}
	if history != nil {
		t.Fatalf("history = %d entries, want none alongside the error", len(history))
	}
	var tooLong *chain.HistoryTooLongError
	if !errors.As(err, &tooLong) || tooLong.Address != "mEndless" || tooLong.Pages != maxHistoryPages {
		t.Fatalf("error = %v, want a *chain.HistoryTooLongError naming mEndless and the cap of %d pages", err, maxHistoryPages)
	}
	if !strings.Contains(err.Error(), "mEndless") || !strings.Contains(err.Error(), fmt.Sprintf("%d pages", maxHistoryPages)) {
		t.Fatalf("error = %q, want it to name the address and the cap of %d pages", err, maxHistoryPages)
	}
	if int(*calls) > maxHistoryPages+2 {
		t.Fatalf("calls = %d, want the reads to stop at the cap", *calls)
	}
}

func TestGetHistoryTreatsAnErrorFieldAsAnError(t *testing.T) {
	for _, route := range []string{"/confirmed/history", "/unconfirmed/history"} {
		client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			if strings.HasSuffix(r.URL.Path, route) {
				w.Write([]byte(`{"address":"mAnchor","result":[],"error":"address history too large"}`))
				return
			}
			w.Write([]byte(`{"address":"mAnchor","result":[{"tx_hash":"tx1","height":5}],"error":""}`))
		})

		history, err := client.GetHistory("mAnchor")
		if err == nil || !strings.Contains(err.Error(), "address history too large") {
			t.Fatalf("%s: history = %+v, err = %v, want the reply's error", route, history, err)
		}
	}
}

// neverSeen is WhatsOnChain's reply for an address with no transaction ever:
// /confirmed/history answers a plain-text 404, /unconfirmed/history an empty
// 200.
func neverSeen(address string, unconfirmed []string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/address/" + address + "/confirmed/history":
			http.Error(w, "Not Found", http.StatusNotFound)
		case "/address/" + address + "/unconfirmed/history":
			result := []map[string]any{}
			for _, txid := range unconfirmed {
				result = append(result, map[string]any{"tx_hash": txid, "height": 0})
			}
			json.NewEncoder(w).Encode(map[string]any{"address": address, "result": result, "error": ""})
		default:
			http.Error(w, "unexpected path", http.StatusTeapot)
		}
	}
}

func TestGetHistoryOfAnAddressWithNoTransactionIsEmptyNotAnError(t *testing.T) {
	client, _ := newTestClient(t, neverSeen("mFresh", nil))

	history, err := client.GetHistory("mFresh")
	if err != nil {
		t.Fatalf("GetHistory: %v, want no error for an address WhatsOnChain has never seen", err)
	}
	if len(history) != 0 {
		t.Fatalf("history = %+v, want empty", history)
	}
}

func TestGetHistoryStillReturnsTheUnconfirmedOnesWhenConfirmedAnswers404(t *testing.T) {
	client, _ := newTestClient(t, neverSeen("mFresh", []string{"tx1", "tx2"}))

	history, err := client.GetHistory("mFresh")
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	want := []HistoryEntry{{TxHash: "tx1", Height: 0}, {TxHash: "tx2", Height: 0}}
	if fmt.Sprint(history) != fmt.Sprint(want) {
		t.Fatalf("history = %+v, want %+v", history, want)
	}
}

func TestGetHistoryFailsWhenALaterConfirmedPageAnswers404(t *testing.T) {
	heights := map[string]int{"a": 1, "b": 2}
	inner := pagedHistory(t, "mAnchor", [][]string{{"b"}, {"a"}}, heights, nil)
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("token") != "" {
			http.Error(w, "Not Found", http.StatusNotFound)
			return
		}
		inner(w, r)
	})

	history, err := client.GetHistory("mAnchor")
	if err == nil {
		t.Fatalf("GetHistory returned %+v and no error, want the 404 on the second page", history)
	}
	if !strings.Contains(err.Error(), "404") {
		t.Fatalf("error = %q, want it to say 404", err)
	}
}

func TestGetHistoryFailsOn404OfTheUnconfirmedHistory(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/unconfirmed/history") {
			http.Error(w, "Not Found", http.StatusNotFound)
			return
		}
		w.Write([]byte(`{"address":"mAnchor","result":[],"error":""}`))
	})

	if history, err := client.GetHistory("mAnchor"); err == nil {
		t.Fatalf("GetHistory returned %+v and no error, want the 404 on /unconfirmed/history", history)
	}
}

func TestGetHistoryFailsOnAServerErrorOrExhaustedRateLimitOnEitherEndpoint(t *testing.T) {
	for _, status := range []int{http.StatusInternalServerError, http.StatusTooManyRequests} {
		for _, route := range []string{"/confirmed/history", "/unconfirmed/history"} {
			client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				if strings.HasSuffix(r.URL.Path, route) {
					http.Error(w, "nope", status)
					return
				}
				w.Write([]byte(`{"address":"mAnchor","result":[],"error":""}`))
			})

			history, err := client.GetHistory("mAnchor")
			if err == nil {
				t.Fatalf("%d on %s: history = %+v and no error, want an error", status, route, history)
			}
			if history != nil {
				t.Fatalf("%d on %s: history = %+v alongside the error, want none", status, route, history)
			}
		}
	}
}

func TestGetTransactionHexFailsOn404(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "Not Found", http.StatusNotFound)
	})

	if hexStr, err := client.GetTransactionHex("tx1"); err == nil {
		t.Fatalf("GetTransactionHex = %q and no error, want the 404 to stay an error", hexStr)
	}
}

func TestGetTransactionHex(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/tx/tx1/hex" {
			t.Errorf("path = %q, want /tx/tx1/hex", r.URL.Path)
		}
		w.Write([]byte("deadbeef\n"))
	})

	hexStr, err := client.GetTransactionHex("tx1")
	if err != nil {
		t.Fatalf("GetTransactionHex: %v", err)
	}
	if hexStr != "deadbeef" {
		t.Fatalf("hexStr = %q, want %q", hexStr, "deadbeef")
	}
}

func TestBroadcastReturnsTxID(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/tx/raw" {
			t.Errorf("method/path = %s %s, want POST /tx/raw", r.Method, r.URL.Path)
		}
		w.Write([]byte(`"abc123"`))
	})

	txid, err := client.Broadcast("deadbeef")
	if err != nil {
		t.Fatalf("Broadcast: %v", err)
	}
	if txid != "abc123" {
		t.Fatalf("txid = %q, want abc123", txid)
	}
}

func TestBroadcastSurfacesProviderError(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("tx rejected: bad-txns-inputs-missingorspent"))
	})

	_, err := client.Broadcast("deadbeef")
	if err == nil {
		t.Fatal("expected an error, got nil")
	}
	apiErr, ok := err.(*APIError)
	if !ok {
		t.Fatalf("error type = %T, want *APIError", err)
	}
	if apiErr.Status != http.StatusBadRequest {
		t.Fatalf("Status = %d, want 400", apiErr.Status)
	}
}

func TestGetUtxos(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`[{"tx_hash":"tx1","tx_pos":0,"value":1000,"height":100}]`))
	})

	utxos, err := client.GetUtxos("mAddr")
	if err != nil {
		t.Fatalf("GetUtxos: %v", err)
	}
	if len(utxos) != 1 || utxos[0].TxHash != "tx1" || utxos[0].TxPos != 0 || utxos[0].Value != 1000 {
		t.Fatalf("utxos = %+v", utxos)
	}
}

func TestGetBalance(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"confirmed":100,"unconfirmed":5}`))
	})

	balance, err := client.GetBalance("mAddr")
	if err != nil {
		t.Fatalf("GetBalance: %v", err)
	}
	if balance.Confirmed != 100 || balance.Unconfirmed != 5 {
		t.Fatalf("balance = %+v", balance)
	}
}

func TestRetriesAfterRateLimit(t *testing.T) {
	var attempt int32
	client, calls := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&attempt, 1)
		if n == 1 {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.Write([]byte(`[]`))
	})

	if _, err := client.GetUtxos("mAddr"); err != nil {
		t.Fatalf("GetUtxos: %v", err)
	}
	if *calls != 2 {
		t.Fatalf("calls = %d, want 2 (one 429, one success)", *calls)
	}
}

func TestGivesUpAfterRepeatedRateLimit(t *testing.T) {
	client, calls := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	})

	_, err := client.GetUtxos("mAddr")
	if err == nil {
		t.Fatal("expected an error after repeated 429s, got nil")
	}
	if *calls < 2 {
		t.Fatalf("calls = %d, want at least 2 (it should retry before giving up)", *calls)
	}
}

func TestDefaultClientHasARequestTimeout(t *testing.T) {
	client := NewClient("http://example.invalid")
	if client.httpClient.Timeout <= 0 {
		t.Fatal("default http client has no timeout: a silent WhatsOnChain would hang a request for ever")
	}
	if client.httpClient == http.DefaultClient {
		t.Fatal("default http client is http.DefaultClient, which has no timeout")
	}
}

func TestRequestToAServerThatNeverAnswersFailsWithinTheTimeout(t *testing.T) {
	var calls int32
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(server.Close)
	t.Cleanup(func() { close(release) })

	client := NewClient(server.URL,
		WithMinSpacing(0),
		WithRetryDelay(time.Millisecond),
		WithSleep(func(time.Duration) {}),
		WithTimeout(100*time.Millisecond),
	)

	done := make(chan error, 1)
	go func() {
		_, err := client.GetHistory("mAddress")
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("GetHistory returned no error from a server that never answered")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("GetHistory hung on a server that never answers")
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("a timed-out request was sent %d times, want 1: retrying a hung server multiplies the wait", got)
	}
}

func TestHistoryCapIsPastSixtyPages(t *testing.T) {
	if maxHistoryPages <= 60 {
		t.Fatalf("maxHistoryPages = %d, want past 60: a key that sends a message per transaction passes 5000 of them", maxHistoryPages)
	}
}

func TestGetSpenderNamesTheTransactionThatSpentAnOutput(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/tx/aa11/0/spent" {
			t.Errorf("path = %q, want /tx/aa11/0/spent", r.URL.Path)
		}
		w.Write([]byte(`{"txid":"bb22","vin":1}`))
	})

	spender, spent, err := client.GetSpender("aa11", 0)
	if err != nil || !spent || spender != "bb22" {
		t.Fatalf("GetSpender = %q, %v, %v; want bb22, true, nil", spender, spent, err)
	}
}

func TestGetSpenderTakesAn404ForAnUnspentOutput(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte("not found"))
	})

	spender, spent, err := client.GetSpender("aa11", 0)
	if err != nil || spent || spender != "" {
		t.Fatalf("GetSpender = %q, %v, %v; want unspent without an error", spender, spent, err)
	}
}

func TestGetSpenderFailsOnAnyOtherAnswer(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})

	if _, _, err := client.GetSpender("aa11", 0); err == nil {
		t.Fatal("GetSpender succeeded on a 500, want an error")
	}
}
