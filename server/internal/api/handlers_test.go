package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/index"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
)

func newTestServer(t *testing.T, wocHandler http.HandlerFunc) (*httptest.Server, *index.Store) {
	t.Helper()
	wocServer := httptest.NewServer(wocHandler)
	t.Cleanup(wocServer.Close)

	client := woc.NewClient(wocServer.URL, woc.WithMinSpacing(0), woc.WithSleep(func(time.Duration) {}))
	store, err := index.Open(t.TempDir())
	if err != nil {
		t.Fatalf("index.Open: %v", err)
	}
	t.Cleanup(func() { store.Close() })

	handler := NewHandler(store, client)
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return server, store
}

func TestHealthz(t *testing.T) {
	server, _ := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {})
	resp, err := http.Get(server.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
}

func TestMessagesReturnsRecordsAfterSince(t *testing.T) {
	server, store := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {})

	store.Append(index.Record{TxID: "tx1", Vout: 0, ScriptHex: "00", FirstSeen: time.Now()})
	store.Append(index.Record{TxID: "tx2", Vout: 0, ScriptHex: "00", FirstSeen: time.Now(), Payload: json.RawMessage(`{"kind":"msg"}`)})

	resp, err := http.Get(server.URL + "/api/messages?since=1")
	if err != nil {
		t.Fatalf("GET /api/messages: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	var out struct {
		Records []index.Record `json:"records"`
		Next    uint64         `json:"next"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if len(out.Records) != 1 || out.Records[0].TxID != "tx2" {
		t.Fatalf("records = %+v, want just tx2", out.Records)
	}
	if out.Next != 2 {
		t.Fatalf("next = %d, want 2", out.Next)
	}
}

func TestMessagesReturnsEmptyArrayNotNullOnEmptyStore(t *testing.T) {
	server, _ := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {})

	resp, err := http.Get(server.URL + "/api/messages?since=0")
	if err != nil {
		t.Fatalf("GET /api/messages: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("reading body: %v", err)
	}
	if !strings.Contains(string(body), `"records":[]`) {
		t.Fatalf("body = %s, want it to contain \"records\":[]", body)
	}
}

func TestMessagesDefaultsSinceToZero(t *testing.T) {
	server, store := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {})
	store.Append(index.Record{TxID: "tx1", Vout: 0, ScriptHex: "00", FirstSeen: time.Now()})

	resp, err := http.Get(server.URL + "/api/messages")
	if err != nil {
		t.Fatalf("GET /api/messages: %v", err)
	}
	defer resp.Body.Close()

	var out struct {
		Records []index.Record `json:"records"`
		Next    uint64         `json:"next"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	if len(out.Records) != 1 {
		t.Fatalf("records = %+v, want 1", out.Records)
	}
}

func TestMessagesRejectsInvalidSince(t *testing.T) {
	server, _ := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {})

	resp, err := http.Get(server.URL + "/api/messages?since=notanumber")
	if err != nil {
		t.Fatalf("GET /api/messages: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func TestBroadcastReturnsTxID(t *testing.T) {
	server, _ := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/tx/raw" {
			t.Errorf("path = %q, want /tx/raw", r.URL.Path)
		}
		w.Write([]byte(`"abc123"`))
	})

	resp, err := http.Post(server.URL+"/api/broadcast", "application/json", strings.NewReader(`{"rawtx":"deadbeef"}`))
	if err != nil {
		t.Fatalf("POST /api/broadcast: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	var out struct {
		TxID string `json:"txid"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	if out.TxID != "abc123" {
		t.Fatalf("txid = %q, want abc123", out.TxID)
	}
}

func TestBroadcastSurfacesProviderError(t *testing.T) {
	server, _ := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("tx rejected"))
	})

	resp, err := http.Post(server.URL+"/api/broadcast", "application/json", strings.NewReader(`{"rawtx":"deadbeef"}`))
	if err != nil {
		t.Fatalf("POST /api/broadcast: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", resp.StatusCode)
	}

	var out struct {
		Error string `json:"error"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	if !strings.Contains(out.Error, "tx rejected") {
		t.Fatalf("error = %q, want it to mention the provider's message", out.Error)
	}
}

func TestBroadcastRejectsMissingRawtx(t *testing.T) {
	server, _ := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {})

	resp, err := http.Post(server.URL+"/api/broadcast", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatalf("POST /api/broadcast: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func TestUtxosProxiesProvider(t *testing.T) {
	server, _ := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/address/mAddr/unspent" {
			t.Errorf("path = %q, want /address/mAddr/unspent", r.URL.Path)
		}
		w.Write([]byte(`[{"tx_hash":"tx1","tx_pos":0,"value":1000,"height":100}]`))
	})

	resp, err := http.Get(server.URL + "/api/utxos/mAddr")
	if err != nil {
		t.Fatalf("GET /api/utxos: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	var out struct {
		Utxos []struct {
			TxID     string `json:"txid"`
			Vout     int    `json:"vout"`
			Satoshis int64  `json:"satoshis"`
			Height   int    `json:"height"`
		} `json:"utxos"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	if len(out.Utxos) != 1 || out.Utxos[0].TxID != "tx1" || out.Utxos[0].Satoshis != 1000 {
		t.Fatalf("utxos = %+v", out.Utxos)
	}
}

func TestBalanceProxiesProvider(t *testing.T) {
	server, _ := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/address/mAddr/balance" {
			t.Errorf("path = %q, want /address/mAddr/balance", r.URL.Path)
		}
		w.Write([]byte(`{"confirmed":100,"unconfirmed":5}`))
	})

	resp, err := http.Get(server.URL + "/api/balance/mAddr")
	if err != nil {
		t.Fatalf("GET /api/balance: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	var out struct {
		Confirmed   int64 `json:"confirmed"`
		Unconfirmed int64 `json:"unconfirmed"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	if out.Confirmed != 100 || out.Unconfirmed != 5 {
		t.Fatalf("balance = %+v", out)
	}
}

func TestUtxosSurfacesProviderError(t *testing.T) {
	server, _ := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})

	resp, err := http.Get(server.URL + "/api/utxos/mAddr")
	if err != nil {
		t.Fatalf("GET /api/utxos: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", resp.StatusCode)
	}
}
