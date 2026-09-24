package woc

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
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

func TestGetHistory(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/address/mAnchor/history" {
			t.Errorf("path = %q, want /address/mAnchor/history", r.URL.Path)
		}
		w.Write([]byte(`[{"tx_hash":"tx1","height":100},{"tx_hash":"tx2"}]`))
	})

	history, err := client.GetHistory("mAnchor")
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if len(history) != 2 {
		t.Fatalf("len(history) = %d, want 2", len(history))
	}
	if history[0].TxHash != "tx1" || history[0].Height != 100 {
		t.Fatalf("history[0] = %+v", history[0])
	}
	if history[1].TxHash != "tx2" || history[1].Height != 0 {
		t.Fatalf("history[1] = %+v, want height 0 for unconfirmed", history[1])
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

	if _, err := client.GetHistory("mAddr"); err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if *calls != 2 {
		t.Fatalf("calls = %d, want 2 (one 429, one success)", *calls)
	}
}

func TestGivesUpAfterRepeatedRateLimit(t *testing.T) {
	client, calls := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	})

	_, err := client.GetHistory("mAddr")
	if err == nil {
		t.Fatal("expected an error after repeated 429s, got nil")
	}
	if *calls < 2 {
		t.Fatalf("calls = %d, want at least 2 (it should retry before giving up)", *calls)
	}
}
