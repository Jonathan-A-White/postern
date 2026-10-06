package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/auth"
	"github.com/Jonathan-A-White/postern/server/internal/blobs"
	"github.com/Jonathan-A-White/postern/server/internal/chain"
	"github.com/Jonathan-A-White/postern/server/internal/index"
	"github.com/Jonathan-A-White/postern/server/internal/push"
)

// fakeChain is a chain.Chain with no provider behind it: what it holds is
// what the routes answer from, and err (when set) is what every call fails
// with.
type fakeChain struct {
	utxos   []chain.Utxo
	balance chain.Balance
	txid    string
	err     error

	broadcast []string
}

var _ chain.Chain = (*fakeChain)(nil)

func (f *fakeChain) GetHistory(string) ([]chain.HistoryEntry, error) { return nil, f.err }
func (f *fakeChain) GetTransactionHex(string) (string, error)        { return "", f.err }
func (f *fakeChain) GetUtxos(string) ([]chain.Utxo, error)           { return f.utxos, f.err }
func (f *fakeChain) GetBalance(string) (chain.Balance, error)        { return f.balance, f.err }
func (f *fakeChain) Broadcast(rawTxHex string) (string, error) {
	f.broadcast = append(f.broadcast, rawTxHex)
	return f.txid, f.err
}

func newFakeChainServer(t *testing.T, c chain.Chain) *httptest.Server {
	t.Helper()
	store, err := index.Open(t.TempDir())
	if err != nil {
		t.Fatalf("index.Open: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	pushStore, err := push.OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("push.OpenStore: %v", err)
	}
	blobStore, err := blobs.OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("blobs.OpenStore: %v", err)
	}
	server := httptest.NewServer(NewHandler(store, c, "test-vapid-public-key", pushStore, blobStore, auth.NewNonceStore(time.Minute), &stubChecker{held: true}))
	t.Cleanup(server.Close)
	return server
}

func TestChainRoutesAnswerFromTheInterface(t *testing.T) {
	fake := &fakeChain{
		utxos:   []chain.Utxo{{TxHash: "t1", TxPos: 2, Value: 700, Height: 9}},
		balance: chain.Balance{Confirmed: 700, Unconfirmed: 5},
		txid:    "newtxid",
	}
	server := newFakeChainServer(t, fake)

	resp := doAuthorized(t, http.MethodGet, server.URL+"/api/utxos/mAddr", nil, server)
	defer resp.Body.Close()
	var utxos struct {
		Utxos []struct {
			TxID     string `json:"txid"`
			Vout     int    `json:"vout"`
			Satoshis int64  `json:"satoshis"`
			Height   int    `json:"height"`
		} `json:"utxos"`
	}
	json.NewDecoder(resp.Body).Decode(&utxos)
	if resp.StatusCode != http.StatusOK || len(utxos.Utxos) != 1 || utxos.Utxos[0].TxID != "t1" || utxos.Utxos[0].Vout != 2 || utxos.Utxos[0].Satoshis != 700 || utxos.Utxos[0].Height != 9 {
		t.Fatalf("utxos: status %d, body %+v", resp.StatusCode, utxos)
	}

	resp = doAuthorized(t, http.MethodGet, server.URL+"/api/balance/mAddr", nil, server)
	defer resp.Body.Close()
	var balance chain.Balance
	json.NewDecoder(resp.Body).Decode(&balance)
	if resp.StatusCode != http.StatusOK || balance != (chain.Balance{Confirmed: 700, Unconfirmed: 5}) {
		t.Fatalf("balance: status %d, body %+v", resp.StatusCode, balance)
	}

	resp = doAuthorized(t, http.MethodPost, server.URL+"/api/broadcast", strings.NewReader(`{"rawtx":"deadbeef"}`), server)
	defer resp.Body.Close()
	var sent struct {
		TxID string `json:"txid"`
	}
	json.NewDecoder(resp.Body).Decode(&sent)
	if resp.StatusCode != http.StatusOK || sent.TxID != "newtxid" || len(fake.broadcast) != 1 || fake.broadcast[0] != "deadbeef" {
		t.Fatalf("broadcast: status %d, txid %q, sent %v", resp.StatusCode, sent.TxID, fake.broadcast)
	}
}

func TestChainProviderErrorAnswers502NamingStatusAndBody(t *testing.T) {
	fake := &fakeChain{err: &chain.ProviderError{Provider: "FakeChain", Status: 400, Body: "tx rejected"}}
	server := newFakeChainServer(t, fake)

	for _, route := range []struct{ method, path, body string }{
		{http.MethodGet, "/api/utxos/mAddr", ""},
		{http.MethodGet, "/api/balance/mAddr", ""},
		{http.MethodPost, "/api/broadcast", `{"rawtx":"deadbeef"}`},
	} {
		resp := doAuthorized(t, route.method, server.URL+route.path, strings.NewReader(route.body), server)
		var out struct {
			Error string `json:"error"`
		}
		json.NewDecoder(resp.Body).Decode(&out)
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadGateway || out.Error != "FakeChain said 400: tx rejected" {
			t.Errorf("%s %s: status %d, error %q, want 502 naming 400 and the body", route.method, route.path, resp.StatusCode, out.Error)
		}
	}
}
