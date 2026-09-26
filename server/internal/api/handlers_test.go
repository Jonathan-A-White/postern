package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/auth"
	"github.com/Jonathan-A-White/postern/server/internal/index"
	"github.com/Jonathan-A-White/postern/server/internal/push"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/ecdsa"
)

var errCheckerFailed = errors.New("licence check failed")

// stubChecker is a LicenceChecker test double that never touches a chain.
type stubChecker struct {
	held bool
	err  error
}

func (c *stubChecker) Held(pubKeyHex string) (bool, error) {
	return c.held, c.err
}

func newTestServer(t *testing.T, wocHandler http.HandlerFunc) (*httptest.Server, *index.Store) {
	t.Helper()
	server, store, _ := newTestServerWithPush(t, wocHandler)
	return server, store
}

func newTestServerWithPush(t *testing.T, wocHandler http.HandlerFunc) (*httptest.Server, *index.Store, *push.Store) {
	t.Helper()
	server, store, pushStore, _ := newTestServerWithChecker(t, wocHandler, &stubChecker{held: true})
	return server, store, pushStore
}

// newTestServerWithChecker builds a test server backed by checker, so tests
// can prove both the "licensed" and "unlicensed" paths through
// requireLicence without a real chain reader.
func newTestServerWithChecker(t *testing.T, wocHandler http.HandlerFunc, checker auth.LicenceChecker) (*httptest.Server, *index.Store, *push.Store, *auth.NonceStore) {
	t.Helper()
	return newTestServerFull(t, wocHandler, checker, auth.NewNonceStore(time.Minute))
}

func newTestServerFull(t *testing.T, wocHandler http.HandlerFunc, checker auth.LicenceChecker, nonces *auth.NonceStore) (*httptest.Server, *index.Store, *push.Store, *auth.NonceStore) {
	t.Helper()
	wocServer := httptest.NewServer(wocHandler)
	t.Cleanup(wocServer.Close)

	client := woc.NewClient(wocServer.URL, woc.WithMinSpacing(0), woc.WithSleep(func(time.Duration) {}))
	store, err := index.Open(t.TempDir())
	if err != nil {
		t.Fatalf("index.Open: %v", err)
	}
	t.Cleanup(func() { store.Close() })

	pushStore, err := push.OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("push.OpenStore: %v", err)
	}

	handler := NewHandler(store, client, "test-vapid-public-key", pushStore, nonces, checker)
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return server, store, pushStore, nonces
}

// authorizedRequest issues its own request against server so it always
// starts from a fresh, unconsumed nonce, then signs it with a freshly
// generated key and attaches the resulting Authorization header.
func authorizedRequest(t *testing.T, server *httptest.Server) http.Header {
	t.Helper()
	privKey, err := btcec.NewPrivateKey()
	if err != nil {
		t.Fatalf("btcec.NewPrivateKey: %v", err)
	}

	resp, err := http.Get(server.URL + "/api/challenge")
	if err != nil {
		t.Fatalf("GET /api/challenge: %v", err)
	}
	defer resp.Body.Close()
	var out struct {
		Nonce string `json:"nonce"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decoding challenge response: %v", err)
	}

	hash := sha256.Sum256([]byte(out.Nonce))
	sig := ecdsa.Sign(privKey, hash[:])
	pubKeyHex := hex.EncodeToString(privKey.PubKey().SerializeCompressed())
	sigHex := hex.EncodeToString(sig.Serialize())

	header := http.Header{}
	header.Set("Authorization", "Postern "+pubKeyHex+":"+out.Nonce+":"+sigHex)
	return header
}

func doAuthorized(t *testing.T, method, url string, body io.Reader, server *httptest.Server) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		t.Fatalf("building request: %v", err)
	}
	req.Header = authorizedRequest(t, server)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	return resp
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

	resp := doAuthorized(t, http.MethodGet, server.URL+"/api/messages?since=1", nil, server)
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

	resp := doAuthorized(t, http.MethodGet, server.URL+"/api/messages?since=0", nil, server)
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

	resp := doAuthorized(t, http.MethodGet, server.URL+"/api/messages", nil, server)
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

	resp := doAuthorized(t, http.MethodGet, server.URL+"/api/messages?since=notanumber", nil, server)
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

	resp := doAuthorized(t, http.MethodPost, server.URL+"/api/broadcast", strings.NewReader(`{"rawtx":"deadbeef"}`), server)
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

	resp := doAuthorized(t, http.MethodPost, server.URL+"/api/broadcast", strings.NewReader(`{"rawtx":"deadbeef"}`), server)
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

	resp := doAuthorized(t, http.MethodPost, server.URL+"/api/broadcast", strings.NewReader(`{}`), server)
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

	resp := doAuthorized(t, http.MethodGet, server.URL+"/api/utxos/mAddr", nil, server)
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

	resp := doAuthorized(t, http.MethodGet, server.URL+"/api/balance/mAddr", nil, server)
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

func TestVAPIDPublicKeyReturnsConfiguredKey(t *testing.T) {
	server, _ := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {})

	resp := doAuthorized(t, http.MethodGet, server.URL+"/api/push/vapid-public-key", nil, server)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	var out struct {
		PublicKey string `json:"publicKey"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	if out.PublicKey != "test-vapid-public-key" {
		t.Fatalf("publicKey = %q, want test-vapid-public-key", out.PublicKey)
	}
}

func TestPushSubscribeStoresSubscription(t *testing.T) {
	server, _, pushStore := newTestServerWithPush(t, func(w http.ResponseWriter, r *http.Request) {})

	body := `{"pubkey":"abc123","subscription":{"endpoint":"https://push.example/1","keys":{"p256dh":"p","auth":"a"}}}`
	resp := doAuthorized(t, http.MethodPost, server.URL+"/api/push/subscribe", strings.NewReader(body), server)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	subs := pushStore.ByPublicKey("abc123")
	if len(subs) != 1 || subs[0].Endpoint != "https://push.example/1" {
		t.Fatalf("subs = %+v, want one subscription for abc123", subs)
	}
}

func TestPushSubscribeRejectsMissingPubkey(t *testing.T) {
	server, _ := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {})

	body := `{"subscription":{"endpoint":"https://push.example/1","keys":{"p256dh":"p","auth":"a"}}}`
	resp := doAuthorized(t, http.MethodPost, server.URL+"/api/push/subscribe", strings.NewReader(body), server)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func TestPushSubscribeRejectsMissingEndpoint(t *testing.T) {
	server, _ := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {})

	body := `{"pubkey":"abc123","subscription":{"keys":{"p256dh":"p","auth":"a"}}}`
	resp := doAuthorized(t, http.MethodPost, server.URL+"/api/push/subscribe", strings.NewReader(body), server)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func TestUtxosSurfacesProviderError(t *testing.T) {
	server, _ := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})

	resp := doAuthorized(t, http.MethodGet, server.URL+"/api/utxos/mAddr", nil, server)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", resp.StatusCode)
	}
}

func TestChallengeReturnsANonce(t *testing.T) {
	server, _ := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {})

	resp, err := http.Get(server.URL + "/api/challenge")
	if err != nil {
		t.Fatalf("GET /api/challenge: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	var out struct {
		Nonce string `json:"nonce"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if out.Nonce == "" {
		t.Fatal("nonce is empty")
	}
}

func TestChallengeReturnsDistinctNoncesEachCall(t *testing.T) {
	server, _ := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {})

	getNonce := func() string {
		resp, err := http.Get(server.URL + "/api/challenge")
		if err != nil {
			t.Fatalf("GET /api/challenge: %v", err)
		}
		defer resp.Body.Close()
		var out struct {
			Nonce string `json:"nonce"`
		}
		json.NewDecoder(resp.Body).Decode(&out)
		return out.Nonce
	}

	if first, second := getNonce(), getNonce(); first == second {
		t.Fatalf("two calls to /api/challenge returned the same nonce %q", first)
	}
}

func TestMessagesRejects401WithNoAuthorizationHeader(t *testing.T) {
	server, _ := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {})

	resp, err := http.Get(server.URL + "/api/messages")
	if err != nil {
		t.Fatalf("GET /api/messages: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}

	var out struct {
		Error string `json:"error"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	if out.Error == "" {
		t.Fatal("error message is empty")
	}
}

func TestMessagesRejects401WithMalformedAuthorizationHeader(t *testing.T) {
	server, _ := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {})

	req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/messages", nil)
	req.Header.Set("Authorization", "not a valid header")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /api/messages: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}

func TestMessagesRejects401WhenNonceIsReplayed(t *testing.T) {
	server, _ := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {})

	header := authorizedRequest(t, server)

	req1, _ := http.NewRequest(http.MethodGet, server.URL+"/api/messages", nil)
	req1.Header = header
	resp1, err := http.DefaultClient.Do(req1)
	if err != nil {
		t.Fatalf("GET /api/messages (first): %v", err)
	}
	resp1.Body.Close()
	if resp1.StatusCode != http.StatusOK {
		t.Fatalf("first request status = %d, want 200", resp1.StatusCode)
	}

	req2, _ := http.NewRequest(http.MethodGet, server.URL+"/api/messages", nil)
	req2.Header = header
	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatalf("GET /api/messages (replay): %v", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusUnauthorized {
		t.Fatalf("replayed request status = %d, want 401", resp2.StatusCode)
	}
}

func TestMessagesRejects401WhenNonceHasExpired(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	nonces := auth.NewNonceStore(time.Minute, auth.WithClock(func() time.Time { return now }))
	server, _, _, _ := newTestServerFull(t, func(w http.ResponseWriter, r *http.Request) {}, &stubChecker{held: true}, nonces)

	header := authorizedRequest(t, server)
	now = now.Add(2 * time.Minute)

	req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/messages", nil)
	req.Header = header
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /api/messages: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}

func TestMessagesRejects401ForASignatureByTheWrongKey(t *testing.T) {
	server, _ := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {})

	resp, err := http.Get(server.URL + "/api/challenge")
	if err != nil {
		t.Fatalf("GET /api/challenge: %v", err)
	}
	defer resp.Body.Close()
	var out struct {
		Nonce string `json:"nonce"`
	}
	json.NewDecoder(resp.Body).Decode(&out)

	signingKey, err := btcec.NewPrivateKey()
	if err != nil {
		t.Fatalf("btcec.NewPrivateKey: %v", err)
	}
	claimedKey, err := btcec.NewPrivateKey()
	if err != nil {
		t.Fatalf("btcec.NewPrivateKey: %v", err)
	}
	hash := sha256.Sum256([]byte(out.Nonce))
	sig := ecdsa.Sign(signingKey, hash[:])
	claimedPubKeyHex := hex.EncodeToString(claimedKey.PubKey().SerializeCompressed())
	sigHex := hex.EncodeToString(sig.Serialize())

	req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/messages", nil)
	req.Header.Set("Authorization", "Postern "+claimedPubKeyHex+":"+out.Nonce+":"+sigHex)
	resp2, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /api/messages: %v", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp2.StatusCode)
	}
}

func TestMessagesRejects401WhenNoLicenceIsHeld(t *testing.T) {
	server, _, _, _ := newTestServerFull(t, func(w http.ResponseWriter, r *http.Request) {}, &stubChecker{held: false}, auth.NewNonceStore(time.Minute))

	resp := doAuthorized(t, http.MethodGet, server.URL+"/api/messages", nil, server)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}

func TestMessagesSurfaces502WhenTheLicenceCheckFails(t *testing.T) {
	checkerErr := &stubChecker{err: errCheckerFailed}
	server, _, _, _ := newTestServerFull(t, func(w http.ResponseWriter, r *http.Request) {}, checkerErr, auth.NewNonceStore(time.Minute))

	resp := doAuthorized(t, http.MethodGet, server.URL+"/api/messages", nil, server)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", resp.StatusCode)
	}
}

func TestHealthzRequiresNoAuthorization(t *testing.T) {
	server, _, _, _ := newTestServerFull(t, func(w http.ResponseWriter, r *http.Request) {}, &stubChecker{held: false}, auth.NewNonceStore(time.Minute))

	resp, err := http.Get(server.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 (healthz needs no proof even with no licence held)", resp.StatusCode)
	}
}
