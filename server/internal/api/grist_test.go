package api

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/auth"
	"github.com/Jonathan-A-White/postern/server/internal/blobs"
	"github.com/Jonathan-A-White/postern/server/internal/index"
	"github.com/Jonathan-A-White/postern/server/internal/push"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
	"github.com/btcsuite/btcd/btcec/v2"
)

// gristVectors is docs/fixtures/grist-vectors.json (docs/protocol.md §18),
// the file the mill's tests read too.
type gristVectors struct {
	Keys map[string]struct {
		PrivateKeyHex string   `json:"privateKeyHex"`
		PublicKeyHex  string   `json:"publicKeyHex"`
		Collections   []string `json:"collections"`
	} `json:"keys"`
	Apps     map[string]string `json:"apps"`
	Delivery []struct {
		As         string   `json:"as"`
		Class      string   `json:"class"`
		To         string   `json:"to"`
		Status     int      `json:"status"`
		SignerApps []string `json:"signerApps"`
		Why        string   `json:"why"`
	} `json:"delivery"`
}

func loadGristVectors(t *testing.T) gristVectors {
	t.Helper()
	raw, err := os.ReadFile("../../../docs/fixtures/grist-vectors.json")
	if err != nil {
		t.Fatalf("reading grist vectors: %v", err)
	}
	var v gristVectors
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("decoding grist vectors: %v", err)
	}
	return v
}

// vectorKey is the vectors' named key, as a signing key and its public hex.
func (v gristVectors) key(t *testing.T, name string) (*btcec.PrivateKey, string) {
	t.Helper()
	entry, ok := v.Keys[name]
	if !ok {
		t.Fatalf("no vector key %q", name)
	}
	raw, err := hex.DecodeString(entry.PrivateKeyHex)
	if err != nil {
		t.Fatalf("vector key %q: %v", name, err)
	}
	priv, _ := btcec.PrivKeyFromBytes(raw)
	if got := hex.EncodeToString(priv.PubKey().SerializeCompressed()); got != entry.PublicKeyHex {
		t.Fatalf("vector key %q: public key %s, file says %s", name, got, entry.PublicKeyHex)
	}
	return priv, entry.PublicKeyHex
}

// collectionsChecker is a CollectionChecker test double: each key holds the
// collections it is given, and nothing else.
type collectionsChecker map[string][]string

func (c collectionsChecker) Held(pubKeyHex string) (bool, error) {
	return len(c[pubKeyHex]) > 0, nil
}

func (c collectionsChecker) HeldCollections(pubKeyHex string) ([]string, error) {
	return c[pubKeyHex], nil
}

// gristServer is a backend with a mill key and Cairn's collection mapped,
// licensing each vector key in the collections the vectors give it.
type gristServer struct {
	*httptest.Server
	store *index.Store
	blobs *blobs.Store
	v     gristVectors
}

func newGristServer(t *testing.T, opts ...Option) gristServer {
	t.Helper()
	v := loadGristVectors(t)
	checker := collectionsChecker{}
	for _, entry := range v.Keys {
		checker[entry.PublicKeyHex] = entry.Collections
	}

	wocServer := httptest.NewServer(http.NotFoundHandler())
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

	opts = append([]Option{WithGrist(v.Keys["mill"].PublicKeyHex, v.Apps)}, opts...)
	handler := NewHandler(store, client, "test-vapid-public-key", pushStore, blobStore, auth.NewNonceStore(time.Minute), checker, opts...)
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return gristServer{Server: server, store: store, blobs: blobStore, v: v}
}

// do sends method path as the vectors' key named as, with body.
func (s gristServer) do(t *testing.T, as, method, path, body string) *http.Response {
	t.Helper()
	priv, _ := s.v.key(t, as)
	req, err := http.NewRequest(method, s.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatalf("building request: %v", err)
	}
	req.Header = authorizedAs(t, s.Server, priv)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return resp
}

// deliver posts a §1 record of class from the key named from to the key
// named to, answering the response.
func (s gristServer) deliver(t *testing.T, class, from, to string) *http.Response {
	t.Helper()
	_, fromHex := s.v.key(t, from)
	_, toHex := s.v.key(t, to)
	payload := fmt.Sprintf(`{"v":1,"kind":"msg","class":%q,"to":%q,"from":%q,"ts":1790000000,"ct":"c2VhbGVk"}`, class, toHex, fromHex)
	body := fmt.Sprintf(`{"scriptHex":%q}`, hex.EncodeToString(recordScript(1, []byte(payload))))
	return s.do(t, from, http.MethodPost, "/api/messages", body)
}

func TestGristDeliveryFollowsTheVectors(t *testing.T) {
	v := loadGristVectors(t)
	for _, tc := range v.Delivery {
		t.Run(tc.Why, func(t *testing.T) {
			s := newGristServer(t)
			resp := s.deliver(t, tc.Class, tc.As, tc.To)
			got := decodeDirect(t, resp)
			if resp.StatusCode != tc.Status {
				t.Fatalf("status = %d (%s), want %d", resp.StatusCode, got.Error, tc.Status)
			}
			if tc.Status != http.StatusCreated {
				return
			}
			records, _ := s.store.Since(0)
			if len(records) != 1 {
				t.Fatalf("stored %d records, want 1", len(records))
			}
			if strings.Join(records[0].SignerApps, ",") != strings.Join(tc.SignerApps, ",") {
				t.Fatalf("signer_apps = %v, want %v", records[0].SignerApps, tc.SignerApps)
			}
		})
	}
}

// messagesFor pages GET /api/messages as the key named as.
func (s gristServer) messagesFor(t *testing.T, as string) ([]index.Record, uint64) {
	t.Helper()
	resp := s.do(t, as, http.MethodGet, "/api/messages?since=0", "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/messages as %s: status %d", as, resp.StatusCode)
	}
	var out struct {
		Records []index.Record `json:"records"`
		Next    uint64         `json:"next"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decoding messages: %v", err)
	}
	return out.Records, out.Next
}

func TestAnAppKeyAndTheMillSeeOnlyTheirOwnRecords(t *testing.T) {
	s := newGristServer(t)
	for _, r := range []struct{ class, from, to string }{
		{"message", "governor", "mill"},
		{"grist", "cairnPhone", "mill"},
		{"grist", "mill", "cairnPhone"},
		{"grist", "mill", "governor"},
	} {
		if resp := s.deliver(t, r.class, r.from, r.to); resp.StatusCode != http.StatusCreated {
			t.Fatalf("delivering %s %s→%s: status %d", r.class, r.from, r.to, resp.StatusCode)
		}
	}

	records, next := s.messagesFor(t, "cairnPhone")
	if len(records) != 2 || next != 4 {
		t.Fatalf("cairnPhone sees %d records (next %d), want its own 2 (next 4, the head)", len(records), next)
	}
	if records, _ := s.messagesFor(t, "mill"); len(records) != 4 {
		t.Fatalf("mill sees %d records, want the 4 to or from it", len(records))
	}
	if records, _ := s.messagesFor(t, "governor"); len(records) != 4 {
		t.Fatalf("governor (a cockpit key) sees %d records, want every record, as before §18", len(records))
	}
}

func TestAppAndMillKeysAreRefusedTheCockpit(t *testing.T) {
	s := newGristServer(t)
	cockpitOnly := []struct{ method, path string }{
		{http.MethodGet, "/api/view"},
		{http.MethodGet, "/api/events"},
		{http.MethodGet, "/api/beads/mw-1"},
		{http.MethodPost, "/api/broadcast"},
		{http.MethodGet, "/api/utxos/mxyz"},
		{http.MethodGet, "/api/balance/mxyz"},
	}
	for _, as := range []string{"cairnPhone", "mill"} {
		for _, route := range cockpitOnly {
			resp := s.do(t, as, route.method, route.path, "")
			resp.Body.Close()
			if resp.StatusCode != http.StatusForbidden {
				t.Fatalf("%s %s as %s: status %d, want 403", route.method, route.path, as, resp.StatusCode)
			}
		}
	}
	for _, route := range []struct{ as, method, path string }{
		{"cairnPhone", http.MethodGet, "/api/blobs/" + strings.Repeat("a", 64)},
		{"cairnPhone", http.MethodDelete, "/api/blobs/" + strings.Repeat("a", 64)},
		{"mill", http.MethodPost, "/api/blobs"},
		{"mill", http.MethodPost, "/api/push/subscribe"},
	} {
		resp := s.do(t, route.as, route.method, route.path, "")
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("%s %s as %s: status %d, want 403", route.method, route.path, route.as, resp.StatusCode)
		}
	}
}

type meBody struct {
	PubKey   string   `json:"pubkey"`
	Mayor    *string  `json:"mayor"`
	Mill     string   `json:"mill"`
	Network  string   `json:"network"`
	Features []string `json:"features"`
	Apps     []string `json:"apps"`
}

func (s gristServer) me(t *testing.T, as string) meBody {
	t.Helper()
	resp := s.do(t, as, http.MethodGet, "/api/me", "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/me as %s: status %d", as, resp.StatusCode)
	}
	var out meBody
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decoding /api/me: %v", err)
	}
	return out
}

func TestMeNamesTheMillToEveryKeyAndTheMayorOnlyToTheCockpit(t *testing.T) {
	s := newGristServer(t, WithIdentity("02"+strings.Repeat("ab", 32), "testnet"))
	_, millHex := s.v.key(t, "mill")

	app := s.me(t, "cairnPhone")
	if app.Mayor != nil || app.Mill != millHex || strings.Join(app.Features, ",") != "grist" || strings.Join(app.Apps, ",") != "cairn" {
		t.Fatalf("app /api/me = %+v, want the mill, features [grist], apps [cairn] and no mayor", app)
	}
	cockpit := s.me(t, "governor")
	if cockpit.Mayor == nil || cockpit.Mill != millHex || !contains(cockpit.Features, "grist") || !contains(cockpit.Features, "view") {
		t.Fatalf("cockpit /api/me = %+v, want the mayor, the mill and every feature plus grist", cockpit)
	}
}

func TestMeWithoutAMillIsUnchanged(t *testing.T) {
	server, _ := newServerWithOptions(t, WithIdentity("02"+strings.Repeat("ab", 32), "testnet"))
	resp := doAuthorized(t, http.MethodGet, server.URL+"/api/me", nil, server)
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if strings.Contains(string(body), `"mill"`) || strings.Contains(string(body), `"grist"`) {
		t.Fatalf("/api/me = %s, want no mill and no grist feature when no mill key is configured", body)
	}
}

func TestTheMillFetchesAndDeletesABlob(t *testing.T) {
	s := newGristServer(t)
	upload := s.do(t, "cairnPhone", http.MethodPost, "/api/blobs", "sealed photo")
	var put struct {
		Hash string `json:"hash"`
	}
	json.NewDecoder(upload.Body).Decode(&put)
	upload.Body.Close()
	if upload.StatusCode != http.StatusCreated {
		t.Fatalf("app upload: status %d, want 201", upload.StatusCode)
	}

	get := s.do(t, "mill", http.MethodGet, "/api/blobs/"+put.Hash, "")
	get.Body.Close()
	if get.StatusCode != http.StatusOK {
		t.Fatalf("mill GET blob: status %d, want 200", get.StatusCode)
	}
	del := s.do(t, "mill", http.MethodDelete, "/api/blobs/"+put.Hash, "")
	del.Body.Close()
	if del.StatusCode != http.StatusNoContent {
		t.Fatalf("mill DELETE blob: status %d, want 204", del.StatusCode)
	}
	again := s.do(t, "mill", http.MethodDelete, "/api/blobs/"+put.Hash, "")
	again.Body.Close()
	if again.StatusCode != http.StatusNotFound {
		t.Fatalf("second DELETE: status %d, want 404", again.StatusCode)
	}
}

func TestPushSubscribeIsBoundToTheProvenKey(t *testing.T) {
	s := newGristServer(t)
	_, own := s.v.key(t, "cairnPhone")
	_, other := s.v.key(t, "governor")
	body := func(pubkey string) string {
		return fmt.Sprintf(`{"pubkey":%q,"subscription":{"endpoint":"https://push.example/1","keys":{"p256dh":"p","auth":"a"}}}`, pubkey)
	}

	someoneElse := s.do(t, "cairnPhone", http.MethodPost, "/api/push/subscribe", body(other))
	someoneElse.Body.Close()
	if someoneElse.StatusCode != http.StatusForbidden {
		t.Fatalf("subscribing another key's pushes: status %d, want 403", someoneElse.StatusCode)
	}
	itself := s.do(t, "cairnPhone", http.MethodPost, "/api/push/subscribe", body(strings.ToUpper(own)))
	itself.Body.Close()
	if itself.StatusCode != http.StatusOK {
		t.Fatalf("subscribing its own pushes: status %d, want 200", itself.StatusCode)
	}
}

func TestAKeyHoldingBothKindsOfLicenceIsACockpitKey(t *testing.T) {
	v := loadGristVectors(t)
	checker := collectionsChecker{v.Keys["governor"].PublicKeyHex: {"cairn", "postern"}}
	r, err := rightsFor(v.Keys["governor"].PublicKeyHex, checker, &options{millKey: v.Keys["mill"].PublicKeyHex, apps: v.Apps})
	if err != nil {
		t.Fatalf("rightsFor: %v", err)
	}
	if !r.cockpit || r.mill || strings.Join(r.apps, ",") != "cairn" {
		t.Fatalf("rights = %+v, want a cockpit key that also names cairn", r)
	}
}

func TestALicenceCheckerThatCannotNameCollectionsLicensesTheCockpit(t *testing.T) {
	r, err := rightsFor("02"+strings.Repeat("cd", 32), &stubChecker{held: true}, &options{})
	if err != nil || !r.cockpit {
		t.Fatalf("rights = %+v, err %v; want a cockpit key, as before §18", r, err)
	}
}

func TestCORSAnswersOnlyTheOriginsItIsGiven(t *testing.T) {
	s := newGristServer(t, WithCORS([]string{"https://jonathan-a-white.github.io"}))

	preflight, _ := http.NewRequest(http.MethodOptions, s.URL+"/api/messages", nil)
	preflight.Header.Set("Origin", "https://jonathan-a-white.github.io")
	preflight.Header.Set("Access-Control-Request-Method", "POST")
	resp, err := http.DefaultClient.Do(preflight)
	if err != nil {
		t.Fatalf("preflight: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent ||
		resp.Header.Get("Access-Control-Allow-Origin") != "https://jonathan-a-white.github.io" ||
		!strings.Contains(resp.Header.Get("Access-Control-Allow-Headers"), "Authorization") ||
		!strings.Contains(resp.Header.Get("Access-Control-Allow-Methods"), "DELETE") {
		t.Fatalf("preflight: status %d, headers %v", resp.StatusCode, resp.Header)
	}

	challenge, _ := http.NewRequest(http.MethodGet, s.URL+"/api/challenge", nil)
	challenge.Header.Set("Origin", "https://jonathan-a-white.github.io")
	resp, err = http.DefaultClient.Do(challenge)
	if err != nil {
		t.Fatalf("GET /api/challenge: %v", err)
	}
	resp.Body.Close()
	if resp.Header.Get("Access-Control-Allow-Origin") != "https://jonathan-a-white.github.io" || resp.Header.Get("Vary") != "Origin" {
		t.Fatalf("an allowed origin's GET: headers %v", resp.Header)
	}

	stranger, _ := http.NewRequest(http.MethodGet, s.URL+"/api/challenge", nil)
	stranger.Header.Set("Origin", "https://evil.example")
	resp, err = http.DefaultClient.Do(stranger)
	if err != nil {
		t.Fatalf("GET /api/challenge: %v", err)
	}
	resp.Body.Close()
	if resp.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("another origin got CORS headers: %v", resp.Header)
	}
}
