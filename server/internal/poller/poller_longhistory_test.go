package poller

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
	"github.com/Jonathan-A-White/postern/server/internal/index"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
)

// longAnchor is WhatsOnChain's replies for an anchor whose confirmed history
// has passed 20,000 transactions (mw-gq6.965: 22,668 on 2026-11-04), served
// 100 a page, newest page first, each page ascending, chained by nextPageToken.
type longAnchor struct {
	txids   []string // oldest first
	hex     map[string]string
	pages   int32 // confirmed pages served
	hexGets int32
}

func newLongAnchor(total int) *longAnchor {
	a := &longAnchor{hex: map[string]string{}}
	for i := 1; i <= total; i++ {
		a.txids = append(a.txids, fmt.Sprintf("tx%06d", i))
	}
	return a
}

func (a *longAnchor) handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/unconfirmed/history"):
			w.Write([]byte(`{"result":[],"error":""}`))
		case strings.HasSuffix(r.URL.Path, "/confirmed/history"):
			atomic.AddInt32(&a.pages, 1)
			// page n (0 = newest) holds txids[len-100(n+1) : len-100n]
			n := 0
			fmt.Sscanf(r.URL.Query().Get("token"), "page%d", &n)
			hi := len(a.txids) - 100*n
			lo := hi - 100
			if lo < 0 {
				lo = 0
			}
			result := []map[string]any{}
			for i := lo; i < hi; i++ {
				result = append(result, map[string]any{"tx_hash": a.txids[i], "height": i + 1})
			}
			reply := map[string]any{"result": result, "error": ""}
			if lo > 0 {
				reply["nextPageToken"] = fmt.Sprintf("page%d", n+1)
			}
			json.NewEncoder(w).Encode(reply)
		case strings.Contains(r.URL.Path, "/tx/") && strings.HasSuffix(r.URL.Path, "/hex"):
			atomic.AddInt32(&a.hexGets, 1)
			txid := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path[strings.Index(r.URL.Path, "/tx/"):], "/tx/"), "/hex")
			if h, ok := a.hex[txid]; ok {
				w.Write([]byte(h))
				return
			}
			http.Error(w, "not found", http.StatusNotFound)
		default:
			http.Error(w, "unexpected "+r.URL.Path, http.StatusTeapot)
		}
	}
}

func openStore(t *testing.T) *index.Store {
	t.Helper()
	store, err := index.Open(t.TempDir())
	if err != nil {
		t.Fatalf("index.Open: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}

func testClient(url string) *woc.Client {
	return woc.NewClient(url, woc.WithMinSpacing(0), woc.WithSleep(func(time.Duration) {}), woc.WithMaxAttempts(1))
}

// His report: 'a message the phone sends on chain does not reach the Mayor'.
// The anchor's history passed the 200 pages GetHistory reads, so every poll
// failed with a HistoryTooLongError and nothing new was indexed.
func TestPollOnceIndexesANewMessageWhenTheAnchorHistoryPassesThe200PageCap(t *testing.T) {
	anchor := newLongAnchor(20_100) // 201 pages
	newest := anchor.txids[len(anchor.txids)-1]
	anchor.hex[newest] = buildRawTx([][]byte{buildRecordScript(1, []byte(`{"kind":"msg","ciphertext":"new"}`))})
	server := httptest.NewServer(anchor.handler())
	defer server.Close()

	store := openStore(t)
	for _, txid := range anchor.txids[:len(anchor.txids)-1] {
		store.MarkSeen(txid) // everything older was walked before the cap was crossed
	}

	if err := New(testClient(server.URL), store, "mAnchor").PollOnce(); err != nil {
		var tooLong *chain.HistoryTooLongError
		if errors.As(err, &tooLong) {
			t.Fatalf("PollOnce failed on the history cap, so the newest message was never indexed: %v", err)
		}
		t.Fatalf("PollOnce: %v", err)
	}
	if got := store.ByTxID(newest); len(got) != 1 {
		t.Fatalf("records for %s = %d, want 1 (the message was not indexed)", newest, len(got))
	}
}

// A poll with nothing new reads the newest page and no more: it used to read
// every page (200 requests, over a minute at WhatsOnChain's pace) every 5 s.
func TestPollOnceWithNothingNewReadsOnePage(t *testing.T) {
	anchor := newLongAnchor(1_050)
	server := httptest.NewServer(anchor.handler())
	defer server.Close()
	store := openStore(t)
	for _, txid := range anchor.txids {
		store.MarkSeen(txid)
	}

	if err := New(testClient(server.URL), store, "mAnchor").PollOnce(); err != nil {
		t.Fatalf("PollOnce: %v", err)
	}
	if pages := atomic.LoadInt32(&anchor.pages); pages != 1 {
		t.Fatalf("confirmed pages read = %d, want 1", pages)
	}
}

// A backlog of several pages (the 2,668 this story found) is read to its end.
func TestPollOnceReadsAWholeBacklogOfSeveralPages(t *testing.T) {
	anchor := newLongAnchor(1_000)
	for _, txid := range anchor.txids[800:] { // the newest 200 are new
		anchor.hex[txid] = buildRawTx([][]byte{buildRecordScript(1, []byte(`{"kind":"msg","ciphertext":"`+txid+`"}`))})
	}
	server := httptest.NewServer(anchor.handler())
	defer server.Close()
	store := openStore(t)
	for _, txid := range anchor.txids[:800] {
		store.MarkSeen(txid)
	}

	if err := New(testClient(server.URL), store, "mAnchor").PollOnce(); err != nil {
		t.Fatalf("PollOnce: %v", err)
	}
	records, _ := store.Since(0)
	if len(records) != 200 || records[0].TxID != anchor.txids[800] || records[199].TxID != anchor.txids[999] {
		t.Fatalf("records = %d (first %v), want the 200 new ones, oldest first", len(records), records[0].TxID)
	}
}

// One transaction that cannot be fetched must not hold back the ones behind
// it, and must be tried again though a later poll never reads its page.
func TestPollOnceCarriesOnPastATransactionItCannotFetchAndRetriesIt(t *testing.T) {
	anchor := newLongAnchor(5)
	for _, txid := range anchor.txids {
		anchor.hex[txid] = buildRawTx([][]byte{buildRecordScript(1, []byte(`{"kind":"msg","ciphertext":"`+txid+`"}`))})
	}
	bad := anchor.txids[1]
	badHex := anchor.hex[bad]
	delete(anchor.hex, bad) // WhatsOnChain answers 404 for it
	server := httptest.NewServer(anchor.handler())
	defer server.Close()
	store := openStore(t)
	p := New(testClient(server.URL), store, "mAnchor", WithLogf(func(string, ...any) {}))

	err := p.PollOnce()
	if err == nil || !strings.Contains(err.Error(), bad) {
		t.Fatalf("PollOnce err = %v, want one naming %s", err, bad)
	}
	if records, _ := store.Since(0); len(records) != 4 {
		t.Fatalf("records after a failing tx = %d, want the 4 others", len(records))
	}

	anchor.hex[bad] = badHex
	if err := p.PollOnce(); err != nil {
		t.Fatalf("second PollOnce: %v", err)
	}
	if len(store.ByTxID(bad)) != 1 {
		t.Fatalf("the transaction that failed was not retried")
	}
}
