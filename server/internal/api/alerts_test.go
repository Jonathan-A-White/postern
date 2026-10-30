package api

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/alerts"
	"github.com/Jonathan-A-White/postern/server/internal/auth"
	"github.com/Jonathan-A-White/postern/server/internal/blobs"
	"github.com/Jonathan-A-White/postern/server/internal/index"
	"github.com/Jonathan-A-White/postern/server/internal/push"
	"github.com/Jonathan-A-White/postern/server/internal/register"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/btcsuite/btcd/btcec/v2"
)

// The alerts feed (docs/protocol.md §26): a licensed key asks for its family's
// address, lists and claims the family's alerts; the receiver posts parsed
// alerts to /api/alerts/inbound with a shared secret.

const (
	alertsDomain = "alerts.test.invalid"
	alertsSecret = "a-shared-secret-from-config"

	// A real P-256 point and auth secret (webpush-go's own tests): a push
	// needs a valid key to encrypt to, but goes to the fake endpoint below.
	alertsP256dh = "BNNL5ZaTfK81qhXOx23-wewhigUeFb632jN6LvRWCFH1ubQr77FE_9qV1FuojuRmHP42zmf34rXgW80OvUVDgTk"
	alertsAuth   = "zqbxT6JKstKSY9JKibZLSQ"
)

// fakeFamilies maps each family's id to its keys: a key in none has no family
// of its own, and is a family of one.
type fakeFamilies map[string][]string

func (f fakeFamilies) Family(key string) string {
	for id, keys := range f {
		for _, k := range keys {
			if k == key {
				return id
			}
		}
	}
	return ""
}

func (f fakeFamilies) Keys(id string) []string { return f[id] }

type alertsServer struct {
	*httptest.Server
	pushes  *atomic.Int32 // sends the fake push service received
	pushURL string
	clock   *alertsClock
	store   *alerts.Store
}

// alertsClock is the alerts store's clock, moved by the test.
type alertsClock struct{ now time.Time }

func (c *alertsClock) Now() time.Time { return c.now }

// newAlertsServer licenses every key in licensed as an app key of "cairn", and
// puts the families' keys together as devices of one licence.
func newAlertsServer(t *testing.T, licensed []string, families fakeFamilies, secret string) alertsServer {
	t.Helper()
	if families == nil {
		return newAlertsServerWith(t, licensed, nil, secret)
	}
	return newAlertsServerWith(t, licensed, families, secret)
}

// newAlertsServerWith is newAlertsServer with any Families (a nil one makes each key a family of one).
func newAlertsServerWith(t *testing.T, licensed []string, families Families, secret string) alertsServer {
	t.Helper()
	checker := collectionsChecker{}
	for _, key := range licensed {
		checker[key] = []string{"cairn"}
	}
	wocServer := httptest.NewServer(http.NotFoundHandler())
	t.Cleanup(wocServer.Close)
	client := woc.NewClient(wocServer.URL, woc.WithMinSpacing(0), woc.WithSleep(func(time.Duration) {}))
	store, err := index.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	pushStore, err := push.OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	blobStore, err := blobs.OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	clk := &alertsClock{now: time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)}
	alertStore, err := alerts.OpenStore(t.TempDir(), alerts.WithClock(clk.Now))
	if err != nil {
		t.Fatal(err)
	}

	pushes := &atomic.Int32{}
	pushService := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		pushes.Add(1)
		w.WriteHeader(http.StatusCreated)
	}))
	t.Cleanup(pushService.Close)
	vapidPriv, vapidPub, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	sender := push.NewSender(push.VAPIDKeys{PublicKey: vapidPub, PrivateKey: vapidPriv}, "https://postern.example", pushStore)

	handler := NewHandler(store, client, vapidPub, pushStore, blobStore, auth.NewNonceStore(time.Minute), checker,
		WithGrist("02"+strings.Repeat("11", 32), map[string]string{"cairn": "cairn"}),
		WithAlerts(alertStore, families, sender, alertsDomain, secret))
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return alertsServer{Server: server, pushes: pushes, pushURL: pushService.URL, clock: clk, store: alertStore}
}

// as sends method path signed by key, with body.
func (s alertsServer) as(t *testing.T, key *btcec.PrivateKey, method, path, body string) (int, string) {
	t.Helper()
	req, err := http.NewRequest(method, s.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	signRequest(t, s.Server, key, req)
	return doRaw(t, req)
}

func doRaw(t *testing.T, req *http.Request) (int, string) {
	t.Helper()
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(data)
}

// inbound posts a parsed alert as the receiver does, with the secret given.
func (s alertsServer) inbound(t *testing.T, secret, body string) (int, string) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, s.URL+"/api/alerts/inbound", strings.NewReader(body))
	if secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}
	return doRaw(t, req)
}

// subscribe registers a push subscription for key at the fake push service.
func (s alertsServer) subscribe(t *testing.T, key *btcec.PrivateKey, pub, name string) {
	t.Helper()
	body := fmt.Sprintf(`{"pubkey":%q,"subscription":{"endpoint":%q,"keys":{"p256dh":%q,"auth":%q}}}`, pub, s.pushURL+"/"+name, alertsP256dh, alertsAuth)
	if status, out := s.as(t, key, http.MethodPost, "/api/push/subscribe", body); status != http.StatusOK {
		t.Fatalf("subscribe %s = %d %s", name, status, out)
	}
}

type alertsList struct {
	Alerts []alerts.Alert `json:"alerts"`
	Next   uint64         `json:"next"`
}

func (s alertsServer) list(t *testing.T, key *btcec.PrivateKey, since uint64) alertsList {
	t.Helper()
	status, body := s.as(t, key, http.MethodGet, fmt.Sprintf("/api/alerts?since=%d", since), "")
	var out alertsList
	if status != http.StatusOK || json.Unmarshal([]byte(body), &out) != nil {
		t.Fatalf("GET /api/alerts = %d %s", status, body)
	}
	return out
}

func (s alertsServer) address(t *testing.T, key *btcec.PrivateKey) string {
	t.Helper()
	status, body := s.as(t, key, http.MethodPost, "/api/alerts/address", "")
	var out struct {
		Address string `json:"address"`
	}
	if status != http.StatusOK || json.Unmarshal([]byte(body), &out) != nil || out.Address == "" {
		t.Fatalf("POST /api/alerts/address = %d %s", status, body)
	}
	return out.Address
}

func hexOf(key *btcec.PrivateKey) string {
	return hex.EncodeToString(key.PubKey().SerializeCompressed())
}

func tokenOf(address string) string { return strings.TrimSuffix(address, "@"+alertsDomain) }

// twoPhones is a family of two licensed keys on one licence, and a stranger's.
func twoPhones(t *testing.T) (alertsServer, [2]*btcec.PrivateKey, [2]string, *btcec.PrivateKey) {
	t.Helper()
	a0, a0Pub := newKey(t)
	a1, a1Pub := newKey(t)
	other, otherPub := newKey(t)
	s := newAlertsServer(t, []string{a0Pub, a1Pub, otherPub}, fakeFamilies{"family-a": {a0Pub, a1Pub}}, alertsSecret)
	return s, [2]*btcec.PrivateKey{a0, a1}, [2]string{a0Pub, a1Pub}, other
}

func TestAnUnlicensedKeyIsRefusedTheAddressTheFeedAndAClaim(t *testing.T) {
	_, a0Pub := newKey(t)
	s := newAlertsServer(t, []string{a0Pub}, fakeFamilies{"family-a": {a0Pub}}, alertsSecret)
	stranger, _ := newKey(t)
	for _, route := range []struct{ method, path string }{
		{http.MethodPost, "/api/alerts/address"},
		{http.MethodGet, "/api/alerts?since=0"},
		{http.MethodDelete, "/api/alerts/abc"},
	} {
		if status, body := s.as(t, stranger, route.method, route.path, ""); status != http.StatusUnauthorized || !strings.Contains(body, "no_licence") {
			t.Fatalf("%s %s unlicensed = %d %s, want 401 no_licence", route.method, route.path, status, body)
		}
	}
}

func TestTheMillKeyIsRefusedTheFeed(t *testing.T) {
	s := newGristServer(t, WithAlerts(nil, nil, nil, alertsDomain, alertsSecret))
	resp := s.do(t, "mill", http.MethodGet, "/api/alerts?since=0", "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("the mill's key on /api/alerts = %d, want 403", resp.StatusCode)
	}
}

func TestTwoKeysOnOneLicenceSeeTheSameAddressAndFeed(t *testing.T) {
	s, keys, _, other := twoPhones(t)
	first, second := s.address(t, keys[0]), s.address(t, keys[1])
	if first != second || !strings.HasSuffix(first, "@"+alertsDomain) || len(tokenOf(first)) != 12 {
		t.Fatalf("addresses %q and %q, want one token@%s with a 12-character token", first, second, alertsDomain)
	}
	if elsewhere := s.address(t, other); elsewhere == first {
		t.Fatalf("a key on another licence got the same address %q", elsewhere)
	}

	status, body := s.inbound(t, alertsSecret, fmt.Sprintf(`{"token":%q,"kind":"charge","amount":"42.17","merchant":"Corner Cafe","last4":"1234","when":"2026-10-30T11:58:00Z"}`, tokenOf(first)))
	if status != http.StatusCreated {
		t.Fatalf("inbound = %d %s", status, body)
	}
	a, b := s.list(t, keys[0], 0), s.list(t, keys[1], 0)
	if len(a.Alerts) != 1 || len(b.Alerts) != 1 || a.Alerts[0] != b.Alerts[0] {
		t.Fatalf("the two keys' feeds: %+v and %+v, want the same one alert", a, b)
	}
	got := a.Alerts[0]
	if got.Kind != "charge" || got.Amount != "42.17" || got.Merchant != "Corner Cafe" || got.Last4 != "1234" || got.ID == "" || got.Seq == 0 {
		t.Fatalf("alert = %+v", got)
	}
	if len(s.list(t, other, 0).Alerts) != 0 {
		t.Fatal("another family's feed holds the alert")
	}
	if next := s.list(t, keys[0], got.Seq); len(next.Alerts) != 0 || next.Next != got.Seq {
		t.Fatalf("since=%d listed %+v, want nothing and next %d", got.Seq, next, got.Seq)
	}
}

func TestAClaimByOneKeyIsGoneForTheOther(t *testing.T) {
	s, keys, _, other := twoPhones(t)
	address := s.address(t, keys[0])
	if status, body := s.inbound(t, alertsSecret, fmt.Sprintf(`{"token":%q,"kind":"unread","subject":"Your statement"}`, tokenOf(address))); status != http.StatusCreated {
		t.Fatalf("inbound = %d %s", status, body)
	}
	id := s.list(t, keys[1], 0).Alerts[0].ID

	s.address(t, other)
	if status, _ := s.as(t, other, http.MethodDelete, "/api/alerts/"+id, ""); status != http.StatusNotFound {
		t.Fatalf("another family's claim = %d, want 404", status)
	}
	if status, body := s.as(t, keys[0], http.MethodDelete, "/api/alerts/"+id, ""); status != http.StatusNoContent {
		t.Fatalf("claim = %d %s, want 204", status, body)
	}
	if got := s.list(t, keys[1], 0).Alerts; len(got) != 0 {
		t.Fatalf("after one phone claimed it the other still lists %+v", got)
	}
	if status, _ := s.as(t, keys[1], http.MethodDelete, "/api/alerts/"+id, ""); status != http.StatusNotFound {
		t.Fatalf("a second claim = %d, want 404", status)
	}
}

func TestInboundWithAWrongOrNoSecretIsRefusedAndStoresNothing(t *testing.T) {
	s, keys, _, _ := twoPhones(t)
	token := tokenOf(s.address(t, keys[0]))
	body := fmt.Sprintf(`{"token":%q,"kind":"charge","amount":"1.00"}`, token)
	for name, secret := range map[string]string{"wrong": "not-the-secret", "none": "", "a prefix": alertsSecret[:5]} {
		if status, out := s.inbound(t, secret, body); status != http.StatusUnauthorized {
			t.Fatalf("%s secret = %d %s, want 401", name, status, out)
		}
	}
	if got := s.list(t, keys[0], 0).Alerts; len(got) != 0 {
		t.Fatalf("a refused inbound was stored: %+v", got)
	}
	if s.pushes.Load() != 0 {
		t.Fatal("a refused inbound pushed")
	}
}

func TestInboundWithNoSecretConfiguredIsNeverAccepted(t *testing.T) {
	closed := newAlertsServer(t, nil, nil, "")
	for _, secret := range []string{"", "anything"} {
		if status, _ := closed.inbound(t, secret, `{"token":"abcdefghijkl","kind":"charge"}`); status != http.StatusNotImplemented {
			t.Fatalf("secret %q with none configured = %d, want 501", secret, status)
		}
	}
}

func TestInboundRefusesAnUnknownTokenAndAnythingButParsedFacts(t *testing.T) {
	s, keys, _, _ := twoPhones(t)
	token := tokenOf(s.address(t, keys[0]))
	for name, tc := range map[string]struct {
		body   string
		status int
	}{
		"an unknown token":     {`{"token":"zzzzzzzzzzzz","kind":"charge"}`, http.StatusNotFound},
		"a mail body":          {fmt.Sprintf(`{"token":%q,"kind":"unread","subject":"x","body":"the whole mail"}`, token), http.StatusBadRequest},
		"a made-up kind":       {fmt.Sprintf(`{"token":%q,"kind":"newsletter"}`, token), http.StatusBadRequest},
		"not JSON":             {`charge`, http.StatusBadRequest},
		"no token":             {`{"kind":"charge"}`, http.StatusNotFound},
		"an over-long subject": {fmt.Sprintf(`{"token":%q,"kind":"unread","subject":%q}`, token, strings.Repeat("s", 2000)), http.StatusBadRequest},
	} {
		if status, out := s.inbound(t, alertsSecret, tc.body); status != tc.status {
			t.Fatalf("%s = %d %s, want %d", name, status, out, tc.status)
		}
	}
	if got := s.list(t, keys[0], 0).Alerts; len(got) != 0 {
		t.Fatalf("refused inbounds were stored: %+v", got)
	}
}

func TestAnInboundChargePushesEverySubscriptionOfTheFamily(t *testing.T) {
	s, keys, pubs, other := twoPhones(t)
	address := s.address(t, keys[0])
	otherPub := hexOf(other)
	s.subscribe(t, keys[0], pubs[0], "phone-0")
	s.subscribe(t, keys[1], pubs[1], "phone-1")
	// A phone on another licence is not pushed.
	s.subscribe(t, other, otherPub, "stranger")

	if status, body := s.inbound(t, alertsSecret, fmt.Sprintf(`{"token":%q,"kind":"charge","amount":"9.99","merchant":"Hardware Store","last4":"4321"}`, tokenOf(address))); status != http.StatusCreated {
		t.Fatalf("inbound = %d %s", status, body)
	}
	if got := s.pushes.Load(); got != 2 {
		t.Fatalf("the fake push service recorded %d sends, want 2 (both subscriptions of the family)", got)
	}
}

func TestAnAppKeysSubscriptionIsPushedNotOnlyTheGovernors(t *testing.T) {
	// Every key in these tests is an app key of "cairn"; this one is alone in its family.
	solo, soloPub := newKey(t)
	s := newAlertsServer(t, []string{soloPub}, nil, alertsSecret)
	s.subscribe(t, solo, soloPub, "solo")
	address := s.address(t, solo)
	if status, body := s.inbound(t, alertsSecret, fmt.Sprintf(`{"token":%q,"kind":"forward-confirm","code":"123456"}`, tokenOf(address))); status != http.StatusCreated {
		t.Fatalf("inbound = %d %s", status, body)
	}
	if got := s.pushes.Load(); got != 1 {
		t.Fatalf("sends = %d, want 1", got)
	}
	if list := s.list(t, solo, 0).Alerts; len(list) != 1 || list[0].Code != "123456" || list[0].Kind != "forward-confirm" {
		t.Fatalf("feed = %+v", list)
	}
}

func TestThePushNamesNoMerchantAmountOrCard(t *testing.T) {
	payload := alertPush(1790000000)
	raw, _ := json.Marshal(payload)
	for _, secret := range []string{"merchant", "amount", "last4", "subject", "code"} {
		if strings.Contains(string(raw), secret) {
			t.Fatalf("push payload %s names %s", raw, secret)
		}
	}
	if payload.Class != "alert" {
		t.Fatalf("class = %q, want alert", payload.Class)
	}
}

func TestAnAlertOlderThanThirtyDaysIsGoneFromTheFeedOnceSwept(t *testing.T) {
	s, keys, _, _ := twoPhones(t)
	address := s.address(t, keys[0])
	s.inbound(t, alertsSecret, fmt.Sprintf(`{"token":%q,"kind":"amazon","merchant":"Amazon"}`, tokenOf(address)))
	s.clock.now = s.clock.now.Add(31 * 24 * time.Hour)
	if _, err := s.store.Sweep(); err != nil {
		t.Fatal(err)
	}
	if got := s.list(t, keys[0], 0).Alerts; len(got) != 0 {
		t.Fatalf("after 31 days: %+v", got)
	}
}

func TestWithoutAlertsConfiguredTheRoutesAnswer501(t *testing.T) {
	s := newGristServer(t)
	for _, route := range []struct{ method, path string }{{http.MethodPost, "/api/alerts/address"}, {http.MethodGet, "/api/alerts?since=0"}} {
		resp := s.do(t, "cairnPhone", route.method, route.path, "")
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotImplemented {
			t.Fatalf("%s %s = %d, want 501", route.method, route.path, resp.StatusCode)
		}
	}
}

// Two devices that joined one person by self-registration are one family: the
// same address, and a push to both.
func TestRegisteredDevicesOfOnePersonAreOneFamily(t *testing.T) {
	svc, err := register.Open(t.TempDir(), register.WithVerifier(regVerifier{}), register.WithIssuer(&regIssuer{}))
	if err != nil {
		t.Fatal(err)
	}
	a0, a0Pub := newKey(t)
	a1, a1Pub := newKey(t)
	_, b0Pub := newKey(t)
	for _, join := range []struct{ email, phone, key string }{
		{"a0@example.com", regPhone, a0Pub},
		{"a1@example.com", regPhone, a1Pub},
		{"b0@example.com", "+14155550999", b0Pub},
	} {
		id, err := svc.Start(context.Background(), join.email, join.phone, join.key)
		if err != nil {
			t.Fatalf("start %s: %v", join.email, err)
		}
		if _, err := svc.Confirm(context.Background(), id, "111111", "222222", "test"); err != nil {
			t.Fatalf("confirm %s: %v", join.email, err)
		}
	}
	families := RegisterFamilies(svc)
	if families.Family(a0Pub) == "" || families.Family(a0Pub) != families.Family(a1Pub) || families.Family(a0Pub) == families.Family(b0Pub) {
		t.Fatalf("families: a0 %q, a1 %q, b0 %q", families.Family(a0Pub), families.Family(a1Pub), families.Family(b0Pub))
	}
	if keys := families.Keys(families.Family(a0Pub)); len(keys) != 2 {
		t.Fatalf("a0's family has keys %v, want its two", keys)
	}

	s := newAlertsServerWith(t, []string{a0Pub, a1Pub, b0Pub}, families, alertsSecret)
	s.subscribe(t, a0, a0Pub, "phone-0")
	s.subscribe(t, a1, a1Pub, "phone-1")
	address := s.address(t, a0)
	if again := s.address(t, a1); again != address {
		t.Fatalf("addresses %q and %q, want one", address, again)
	}
	if status, body := s.inbound(t, alertsSecret, fmt.Sprintf(`{"token":%q,"kind":"charge","amount":"5.00"}`, tokenOf(address))); status != http.StatusCreated {
		t.Fatalf("inbound = %d %s", status, body)
	}
	if got := s.pushes.Load(); got != 2 {
		t.Fatalf("sends = %d, want 2", got)
	}
}
