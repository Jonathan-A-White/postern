package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/auth"
	"github.com/Jonathan-A-White/postern/server/internal/buildinfo"
	"github.com/Jonathan-A-White/postern/server/internal/blobs"
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

	blobStore, err := blobs.OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("blobs.OpenStore: %v", err)
	}

	handler := NewHandler(store, client, "test-vapid-public-key", pushStore, blobStore, nonces, checker)
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return server, store, pushStore, nonces
}

// newTestServerWithBlobs builds a test server the same way newTestServerFull
// does, but hands back the blobs.Store backing it too, for tests that need
// to inspect what's on disk.
func newTestServerWithBlobs(t *testing.T, wocHandler http.HandlerFunc) (*httptest.Server, *blobs.Store) {
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

	blobStore, err := blobs.OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("blobs.OpenStore: %v", err)
	}

	handler := NewHandler(store, client, "test-vapid-public-key", pushStore, blobStore, auth.NewNonceStore(time.Minute), &stubChecker{held: true})
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return server, blobStore
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
	return authorizedAs(t, server, privKey)
}

// authorizedAs is authorizedRequest, signed by privKey rather than a fresh
// key, for tests that need to know which key the request authenticates as.
func authorizedAs(t *testing.T, server *httptest.Server, privKey *btcec.PrivateKey) http.Header {
	t.Helper()
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
	if ct := resp.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	var got struct {
		OK      bool   `json:"ok"`
		Standby bool   `json:"standby"`
		Home    string `json:"home"`
		Commit  string `json:"commit"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decoding healthz body: %v", err)
	}
	if !got.OK || got.Standby || got.Home != "" {
		t.Errorf("healthz = %+v, want ok true, standby false, no home", got)
	}
	// A test binary carries no vcs stamp, so this reads "dev"; a real build
	// reads its short revision. Either way it is what buildinfo says.
	if got.Commit == "" || got.Commit != buildinfo.Commit() {
		t.Errorf("commit = %q, want %q", got.Commit, buildinfo.Commit())
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

	key, pubKeyHex := newKey(t)
	body := `{"pubkey":"` + pubKeyHex + `","subscription":{"endpoint":"https://push.example/1","keys":{"p256dh":"p","auth":"a"}}}`
	req, err := http.NewRequest(http.MethodPost, server.URL+"/api/push/subscribe", strings.NewReader(body))
	if err != nil {
		t.Fatalf("building request: %v", err)
	}
	req.Header = authorizedAs(t, server, key)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST /api/push/subscribe: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	subs := pushStore.ByPublicKey(pubKeyHex)
	if len(subs) != 1 || subs[0].Endpoint != "https://push.example/1" {
		t.Fatalf("subs = %+v, want one subscription for the signing key", subs)
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

func TestBlobUploadRejects401WithNoAuthorizationHeader(t *testing.T) {
	server, _ := newTestServerWithBlobs(t, func(w http.ResponseWriter, r *http.Request) {})

	resp, err := http.Post(server.URL+"/api/blobs", "application/octet-stream", strings.NewReader("hello"))
	if err != nil {
		t.Fatalf("POST /api/blobs: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}

func TestBlobUploadRejects413OverTheCap(t *testing.T) {
	server, _ := newTestServerWithBlobs(t, func(w http.ResponseWriter, r *http.Request) {})

	body := bytes.Repeat([]byte("x"), blobs.MaxBodyBytes+1024)
	resp := doAuthorized(t, http.MethodPost, server.URL+"/api/blobs", bytes.NewReader(body), server)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", resp.StatusCode)
	}
}

func TestBlobUploadStoresANewBlobAndReturns201(t *testing.T) {
	server, _ := newTestServerWithBlobs(t, func(w http.ResponseWriter, r *http.Request) {})

	body := []byte("a brand new encrypted attachment")
	resp := doAuthorized(t, http.MethodPost, server.URL+"/api/blobs", bytes.NewReader(body), server)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}

	var out struct {
		Hash string `json:"hash"`
		Size int    `json:"size"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	wantSum := sha256.Sum256(body)
	if out.Hash != hex.EncodeToString(wantSum[:]) {
		t.Fatalf("hash = %q, want the body's sha256 %x", out.Hash, wantSum)
	}
	if out.Size != len(body) {
		t.Fatalf("size = %d, want %d", out.Size, len(body))
	}
}

func TestBlobUploadRepeatReturns200WithSameHash(t *testing.T) {
	server, _ := newTestServerWithBlobs(t, func(w http.ResponseWriter, r *http.Request) {})

	body := []byte("the same bytes, uploaded twice")
	resp1 := doAuthorized(t, http.MethodPost, server.URL+"/api/blobs", bytes.NewReader(body), server)
	defer resp1.Body.Close()
	var out1 struct {
		Hash string `json:"hash"`
	}
	json.NewDecoder(resp1.Body).Decode(&out1)

	resp2 := doAuthorized(t, http.MethodPost, server.URL+"/api/blobs", bytes.NewReader(body), server)
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 on repeat upload", resp2.StatusCode)
	}
	var out2 struct {
		Hash string `json:"hash"`
		Size int    `json:"size"`
	}
	json.NewDecoder(resp2.Body).Decode(&out2)
	if out2.Hash != out1.Hash {
		t.Fatalf("repeat upload hash = %q, want %q", out2.Hash, out1.Hash)
	}
	if out2.Size != len(body) {
		t.Fatalf("repeat upload size = %d, want %d", out2.Size, len(body))
	}
}

func TestBlobDownloadReturnsUploadedBytes(t *testing.T) {
	server, _ := newTestServerWithBlobs(t, func(w http.ResponseWriter, r *http.Request) {})

	body := []byte("bytes to round-trip through GET /api/blobs/{hash}")
	uploadResp := doAuthorized(t, http.MethodPost, server.URL+"/api/blobs", bytes.NewReader(body), server)
	var out struct {
		Hash string `json:"hash"`
	}
	json.NewDecoder(uploadResp.Body).Decode(&out)
	uploadResp.Body.Close()

	resp := doAuthorized(t, http.MethodGet, server.URL+"/api/blobs/"+out.Hash, nil, server)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "application/octet-stream" {
		t.Fatalf("Content-Type = %q, want application/octet-stream", ct)
	}
	got, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("reading body: %v", err)
	}
	if !bytes.Equal(got, body) {
		t.Fatalf("downloaded bytes don't match what was uploaded")
	}
}

func TestBlobDownloadRejects404ForUnknownHash(t *testing.T) {
	server, _ := newTestServerWithBlobs(t, func(w http.ResponseWriter, r *http.Request) {})

	resp := doAuthorized(t, http.MethodGet, server.URL+"/api/blobs/"+strings.Repeat("a", 64), nil, server)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
}

func TestBlobDownloadRejects401WithNoAuthorizationHeader(t *testing.T) {
	server, _ := newTestServerWithBlobs(t, func(w http.ResponseWriter, r *http.Request) {})

	resp, err := http.Get(server.URL + "/api/blobs/" + strings.Repeat("a", 64))
	if err != nil {
		t.Fatalf("GET /api/blobs/{hash}: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
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

// twoBackends builds two backends over one data directory's nonce key, as
// the home and the boost are once the mirror has copied it (mw-43v9x.19).
func twoBackends(t *testing.T, now func() time.Time) (a, b *httptest.Server) {
	t.Helper()
	dir := t.TempDir()
	build := func(dir string) *httptest.Server {
		key, err := auth.LoadOrCreateNonceKey(dir)
		if err != nil {
			t.Fatalf("LoadOrCreateNonceKey: %v", err)
		}
		nonces := auth.NewNonceStore(time.Minute, auth.WithKey(key), auth.WithClock(now))
		server, _, _, _ := newTestServerFull(t, func(w http.ResponseWriter, r *http.Request) {}, &stubChecker{held: true}, nonces)
		return server
	}
	a = build(dir)
	// The mirror copies the data directory: B starts from a copy of A's key.
	copyDir := t.TempDir()
	keyBytes, err := os.ReadFile(filepath.Join(dir, auth.NonceKeyFile))
	if err != nil {
		t.Fatalf("reading key file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(copyDir, auth.NonceKeyFile), keyBytes, 0o600); err != nil {
		t.Fatalf("copying key file: %v", err)
	}
	b = build(copyDir)
	return a, b
}

// signedHeaderFrom takes a challenge from issuer and signs it.
func signedHeaderFrom(t *testing.T, issuer *httptest.Server) http.Header {
	t.Helper()
	return authorizedRequest(t, issuer)
}

func statusOf(t *testing.T, server *httptest.Server, header http.Header) int {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/messages", nil)
	req.Header = header
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /api/messages: %v", err)
	}
	resp.Body.Close()
	return resp.StatusCode
}

func TestAChallengeFromOneBackendIsAcceptedOnceByTheOther(t *testing.T) {
	a, b := twoBackends(t, time.Now)

	header := signedHeaderFrom(t, a)
	if got := statusOf(t, b, header); got != http.StatusOK {
		t.Fatalf("B on A's challenge: status = %d, want 200", got)
	}
	if got := statusOf(t, b, header); got != http.StatusUnauthorized {
		t.Fatalf("B on the same nonce again: status = %d, want 401", got)
	}
}

func TestATamperedChallengeIsRefusedByBothBackends(t *testing.T) {
	a, b := twoBackends(t, time.Now)

	header := signedHeaderFrom(t, a)
	parts := strings.Split(strings.TrimPrefix(header.Get("Authorization"), "Postern "), ":")
	raw := []byte(parts[1])
	if raw[len(raw)-1] == '0' {
		raw[len(raw)-1] = '1'
	} else {
		raw[len(raw)-1] = '0'
	}
	// The signature is over the original nonce, so re-sign the tampered one
	// with the same key to isolate the nonce check.
	privKey, _ := btcec.NewPrivateKey()
	hash := sha256.Sum256(raw)
	sig := ecdsa.Sign(privKey, hash[:])
	tampered := http.Header{}
	tampered.Set("Authorization", "Postern "+hex.EncodeToString(privKey.PubKey().SerializeCompressed())+":"+string(raw)+":"+hex.EncodeToString(sig.Serialize()))

	for name, server := range map[string]*httptest.Server{"A": a, "B": b} {
		if got := statusOf(t, server, tampered); got != http.StatusUnauthorized {
			t.Fatalf("%s on a tampered nonce: status = %d, want 401", name, got)
		}
	}
}

func TestAnExpiredChallengeIsRefusedByBothBackends(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	a, b := twoBackends(t, func() time.Time { return now })

	header := signedHeaderFrom(t, a)
	now = now.Add(2 * time.Minute)
	for name, server := range map[string]*httptest.Server{"A": a, "B": b} {
		if got := statusOf(t, server, header); got != http.StatusUnauthorized {
			t.Fatalf("%s on an expired nonce: status = %d, want 401", name, got)
		}
	}
}

func TestANonceIsRefusedASecondTimeOnTheSameBackend(t *testing.T) {
	a, _ := twoBackends(t, time.Now)

	header := signedHeaderFrom(t, a)
	if got := statusOf(t, a, header); got != http.StatusOK {
		t.Fatalf("first use on A: status = %d, want 200", got)
	}
	if got := statusOf(t, a, header); got != http.StatusUnauthorized {
		t.Fatalf("second use on A: status = %d, want 401", got)
	}
}
