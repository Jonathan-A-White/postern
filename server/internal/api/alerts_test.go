package api

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/alerts"
	"github.com/Jonathan-A-White/postern/server/internal/alertsmail"
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

// subscribeCards is subscribe with a list of last fours, as JSON.
func (s alertsServer) subscribeCards(t *testing.T, key *btcec.PrivateKey, pub, name, last4s string) {
	t.Helper()
	body := fmt.Sprintf(`{"pubkey":%q,"subscription":{"endpoint":%q,"keys":{"p256dh":%q,"auth":%q}},"last4s":%s}`, pub, s.pushURL+"/"+name, alertsP256dh, alertsAuth, last4s)
	if status, out := s.as(t, key, http.MethodPost, "/api/push/subscribe", body); status != http.StatusOK {
		t.Fatalf("subscribe %s = %d %s", name, status, out)
	}
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

// tokenCheck asks, as the receiver does before it takes a mail, whether a
// family owns the token.
func (s alertsServer) tokenCheck(t *testing.T, secret, token string) (int, string) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, s.URL+"/api/alerts/inbound/"+token, nil)
	if secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}
	return doRaw(t, req)
}

func TestTheReceiverCanAskWhetherATokenIsKnownWithTheSecretOnly(t *testing.T) {
	s, keys, _, _ := twoPhones(t)
	token := tokenOf(s.address(t, keys[0]))
	if status, out := s.tokenCheck(t, alertsSecret, token); status != http.StatusNoContent {
		t.Fatalf("a known token = %d %s, want 204", status, out)
	}
	if status, out := s.tokenCheck(t, alertsSecret, "zzzzzzzzzzzz"); status != http.StatusNotFound {
		t.Fatalf("an unknown token = %d %s, want 404", status, out)
	}
	for name, secret := range map[string]string{"wrong": "not-the-secret", "none": ""} {
		if status, out := s.tokenCheck(t, secret, token); status != http.StatusUnauthorized {
			t.Fatalf("%s secret = %d %s, want 401", name, status, out)
		}
	}
	if got := s.list(t, keys[0], 0).Alerts; len(got) != 0 {
		t.Fatalf("asking about a token stored an alert: %+v", got)
	}
	closed := newAlertsServer(t, nil, nil, "")
	if status, _ := closed.tokenCheck(t, "anything", token); status != http.StatusNotImplemented {
		t.Fatalf("with no secret configured = %d, want 501", status)
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

func TestAConfirmLinkIsPostedAndAnswered(t *testing.T) {
	solo, soloPub := newKey(t)
	s := newAlertsServer(t, []string{soloPub}, nil, alertsSecret)
	address := s.address(t, solo)
	link := "https://mail.google.com/mail/vf-%5BMADE-UP%5D--abc"
	if status, body := s.inbound(t, alertsSecret, fmt.Sprintf(`{"token":%q,"kind":"forward-confirm","link":%q}`, tokenOf(address), link)); status != http.StatusCreated {
		t.Fatalf("inbound = %d %s", status, body)
	}
	if list := s.list(t, solo, 0).Alerts; len(list) != 1 || list[0].Link != link {
		t.Fatalf("feed = %+v", list)
	}
	bad := fmt.Sprintf(`{"token":%q,"kind":"forward-confirm","link":"https://evil.example/x"}`, tokenOf(address))
	if status, _ := s.inbound(t, alertsSecret, bad); status != http.StatusBadRequest {
		t.Fatalf("a link on another host = %d, want 400", status)
	}
}

func TestThePushNamesNoMerchantAmountOrCard(t *testing.T) {
	payload := alertPush(1790000000)
	raw, _ := json.Marshal(payload)
	for _, secret := range []string{"merchant", "amount", "last4", "subject", "code", "link"} {
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

func TestOnlyAChargeCarriesItsFactsToThePusher(t *testing.T) {
	charge := alertFacts(alerts.Alert{ID: "a-1", Kind: alerts.KindCharge, Amount: "42.17", Merchant: "Corner Cafe", Last4: "1234", Subject: "s", Code: "c"})
	if !charge.Charge || charge.ID != "a-1" || charge.Amount != "42.17" || charge.Merchant != "Corner Cafe" || charge.Last4 != "1234" {
		t.Fatalf("charge facts = %+v", charge)
	}
	for _, kind := range []string{alerts.KindAmazon, alerts.KindUnread, alerts.KindForwardConfirm} {
		if alertFacts(alerts.Alert{ID: "a-2", Kind: kind, Merchant: "Amazon"}).Charge {
			t.Fatalf("a %s alert is not a charge", kind)
		}
	}
}

// An inbound charge reaches a subscription that named its card, and a phone with no list, through
// the real sender: both are accepted by the push service, one push each.
func TestAnInboundChargePushesEveryPhoneOfTheFamilyWhateverItsList(t *testing.T) {
	s, keys, pubs, _ := twoPhones(t)
	s.subscribeCards(t, keys[0], pubs[0], "phone-0", `["1234"]`)
	s.subscribe(t, keys[1], pubs[1], "phone-1")
	address := s.address(t, keys[0])
	if status, body := s.inbound(t, alertsSecret, fmt.Sprintf(`{"token":%q,"kind":"charge","amount":"42.17","merchant":"Corner Cafe","last4":"9999"}`, tokenOf(address))); status != http.StatusCreated {
		t.Fatalf("inbound = %d %s", status, body)
	}
	if got := s.pushes.Load(); got != 2 {
		t.Fatalf("pushes = %d, want 2", got)
	}
}

// The second token: the sermon-index reader is a licensed key of its own, so
// its family is its own, and a sermon-notes alert posted to its token is its
// feed alone; the family's bank feed never lists it, and a claim by one family
// never reaches the other.
func TestASermonNotesAlertIsListedAndClaimedOnlyByTheFamilyOfItsToken(t *testing.T) {
	s, keys, _, sermons := twoPhones(t)
	bank, notes := s.address(t, keys[0]), s.address(t, sermons)
	if bank == notes {
		t.Fatalf("both families have %q", bank)
	}
	if status, out := s.inbound(t, alertsSecret, fmt.Sprintf(`{"token":%q,"kind":"sermon-notes","title":"The Day of the Lord","reference":"2 Peter 3:10-18","when":"2026-11-08T00:00:00-05:00"}`, tokenOf(notes))); status != http.StatusCreated {
		t.Fatalf("inbound sermon-notes = %d %s", status, out)
	}
	if status, out := s.inbound(t, alertsSecret, fmt.Sprintf(`{"token":%q,"kind":"charge","amount":"42.17","merchant":"Corner Cafe","last4":"1234"}`, tokenOf(bank))); status != http.StatusCreated {
		t.Fatalf("inbound charge = %d %s", status, out)
	}
	got := s.list(t, sermons, 0).Alerts
	if len(got) != 1 || got[0].Kind != "sermon-notes" || got[0].Title != "The Day of the Lord" || got[0].Reference != "2 Peter 3:10-18" || got[0].When != "2026-11-08T00:00:00-05:00" {
		t.Fatalf("the sermon reader's feed = %+v, want the one sermon-notes alert", got)
	}
	for _, a := range s.list(t, keys[0], 0).Alerts {
		if a.Kind == "sermon-notes" {
			t.Fatalf("the bank family's feed lists a sermon-notes alert: %+v", a)
		}
	}
	if status, _ := s.as(t, keys[0], http.MethodDelete, "/api/alerts/"+got[0].ID, ""); status != http.StatusNotFound {
		t.Fatalf("the bank family's claim of a sermon alert = %d, want 404", status)
	}
	if status, _ := s.as(t, sermons, http.MethodDelete, "/api/alerts/"+got[0].ID, ""); status != http.StatusNoContent {
		t.Fatalf("the sermon reader's claim = %d, want 204", status)
	}
	if left := s.list(t, keys[0], 0).Alerts; len(left) != 1 || left[0].Kind != "charge" {
		t.Fatalf("the bank feed after the sermon claim = %+v, want its charge", left)
	}
}

// A Gmail confirmation mail goes through the receiver's parse and its real
// post to the real inbound handler, and the alert read back carries the link:
// the receiver left the link out of its post, so it was parsed and lost.
func TestAConfirmMailThroughTheReceiverKeepsItsLinkInTheFeed(t *testing.T) {
	raw, err := os.ReadFile("../alertsmail/testdata/gmail-confirm.eml")
	if err != nil {
		t.Fatal(err)
	}
	alert := alertsmail.Parse(raw).Alert()
	if alert.Kind != "forward-confirm" || alert.Link == "" {
		t.Fatalf("the parse gave %+v, want a forward-confirm with a link", alert)
	}
	solo, soloPub := newKey(t)
	s := newAlertsServer(t, []string{soloPub}, nil, alertsSecret)
	address := s.address(t, solo)
	inbound := &alertsmail.HTTPInbound{URL: s.URL, Secret: alertsSecret}
	if err := inbound.Post(context.Background(), tokenOf(address), alert); err != nil {
		t.Fatalf("Post = %v", err)
	}
	if list := s.list(t, solo, 0).Alerts; len(list) != 1 || list[0].Link != alert.Link {
		t.Fatalf("feed = %+v, want the link %q", list, alert.Link)
	}
}

// ---- a sermon-notes alert's notes (GET /api/alerts/{id}/notes) --------------

// notesPDF is n bytes that begin '%PDF-' and are garbage after.
func notesPDF(n int) []byte {
	b := make([]byte, n)
	for i := range b {
		b[i] = byte(i*11 + 2)
	}
	copy(b, "%PDF-1.7 API-NOTES-MARKER")
	return b
}

// notes asks for an alert's notes as key: the status, the body's bytes and
// the Content-Type.
func (s alertsServer) notes(t *testing.T, key *btcec.PrivateKey, id string) (int, []byte, string) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, s.URL+"/api/alerts/"+id+"/notes", nil)
	if err != nil {
		t.Fatal(err)
	}
	signRequest(t, s.Server, key, req)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, data, resp.Header.Get("Content-Type")
}

// postNotes posts a sermon-notes alert with the PDF's bytes to the token.
func (s alertsServer) postNotes(t *testing.T, token string, pdf []byte) string {
	t.Helper()
	body := fmt.Sprintf(`{"token":%q,"kind":"sermon-notes","title":"Grace","reference":"Romans 8:1-4","notes":%q}`, token, base64.StdEncoding.EncodeToString(pdf))
	status, out := s.inbound(t, alertsSecret, body)
	if status != http.StatusCreated {
		t.Fatalf("inbound sermon-notes with notes = %d %s", status, out)
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal([]byte(out), &created); err != nil || created.ID == "" {
		t.Fatalf("inbound answered %s", out)
	}
	return created.ID
}

// The list carries a sermon-notes alert's notes_sha256 and notes_size and
// never its bytes; GET /api/alerts/{id}/notes answers the bytes, signed, to
// the alert's own family only: 404 for another family's alert, an unknown id
// or an alert with no notes, and the licence rule of GET /api/alerts.
func TestASermonNotesAlertsNotesAreListedByHashAndServedToItsFamilyOnly(t *testing.T) {
	s, keys, _, sermons := twoPhones(t)
	bank, notes := tokenOf(s.address(t, keys[0])), tokenOf(s.address(t, sermons))
	pdf := notesPDF(70000)
	id := s.postNotes(t, notes, pdf)
	sum := sha256.Sum256(pdf)

	status, body := s.as(t, sermons, http.MethodGet, "/api/alerts?since=0", "")
	if status != http.StatusOK {
		t.Fatalf("GET /api/alerts = %d %s", status, body)
	}
	if !strings.Contains(body, `"notes_sha256":"`+hex.EncodeToString(sum[:])+`"`) || !strings.Contains(body, fmt.Sprintf(`"notes_size":%d`, len(pdf))) {
		t.Fatalf("the list = %s, want notes_sha256 and notes_size", body)
	}
	if strings.Contains(body, `"notes"`) || strings.Contains(body, base64.StdEncoding.EncodeToString(pdf[:30])) {
		t.Fatalf("the list carries the notes' bytes: %.300s", body)
	}

	status, got, contentType := s.notes(t, sermons, id)
	if status != http.StatusOK || contentType != "application/pdf" {
		t.Fatalf("GET notes = %d %q", status, contentType)
	}
	if gotSum := sha256.Sum256(got); gotSum != sum {
		t.Fatalf("GET notes answered %d bytes whose sha256 is not the PDF's", len(got))
	}

	if status, _, _ := s.notes(t, keys[0], id); status != http.StatusNotFound {
		t.Fatalf("another family's GET notes = %d, want 404", status)
	}
	if status, _, _ := s.notes(t, sermons, "0123456789abcdef"); status != http.StatusNotFound {
		t.Fatalf("an unknown id's notes = %d, want 404", status)
	}
	status, out := s.inbound(t, alertsSecret, fmt.Sprintf(`{"token":%q,"kind":"sermon-notes","title":"No notes"}`, notes))
	var plain struct {
		ID string `json:"id"`
	}
	if status != http.StatusCreated || json.Unmarshal([]byte(out), &plain) != nil {
		t.Fatalf("inbound without notes = %d %s", status, out)
	}
	if status, _, _ := s.notes(t, sermons, plain.ID); status != http.StatusNotFound {
		t.Fatalf("an alert with no notes = %d, want 404", status)
	}
	listed := s.list(t, sermons, 0).Alerts
	if len(listed) != 2 || listed[1].NotesSHA256 != "" || listed[1].NotesSize != 0 {
		t.Fatalf("the alert with no notes is listed as %+v", listed)
	}

	stranger, _ := newKey(t)
	if status, body := s.as(t, stranger, http.MethodGet, "/api/alerts/"+id+"/notes", ""); status != http.StatusUnauthorized || !strings.Contains(body, "no_licence") {
		t.Fatalf("unlicensed GET notes = %d %s, want 401 no_licence", status, body)
	}
	unsigned, _ := http.NewRequest(http.MethodGet, s.URL+"/api/alerts/"+id+"/notes", nil)
	if status, _ := doRaw(t, unsigned); status != http.StatusUnauthorized {
		t.Fatalf("unsigned GET notes = %d, want 401", status)
	}
	if status, _ := s.inbound(t, alertsSecret, fmt.Sprintf(`{"token":%q,"kind":"charge","amount":"1.00","notes":%q}`, bank, base64.StdEncoding.EncodeToString(pdf))); status != http.StatusBadRequest {
		t.Fatalf("a charge with notes = %d, want 400", status)
	}
}

// Claiming the alert removes its notes, and the 30-day forgetting does too:
// the notes route answers 404 after each.
func TestTheNotesRouteAnswers404AfterAClaimAndAfterTheSweep(t *testing.T) {
	s, _, _, sermons := twoPhones(t)
	token := tokenOf(s.address(t, sermons))
	claimed := s.postNotes(t, token, notesPDF(500))
	if status, _ := s.as(t, sermons, http.MethodDelete, "/api/alerts/"+claimed, ""); status != http.StatusNoContent {
		t.Fatalf("claim = %d", status)
	}
	if status, _, _ := s.notes(t, sermons, claimed); status != http.StatusNotFound {
		t.Fatalf("notes after the claim = %d, want 404", status)
	}
	forgotten := s.postNotes(t, token, notesPDF(500))
	s.clock.now = s.clock.now.Add(31 * 24 * time.Hour)
	if _, err := s.store.Sweep(); err != nil {
		t.Fatal(err)
	}
	if status, _, _ := s.notes(t, sermons, forgotten); status != http.StatusNotFound {
		t.Fatalf("notes after 31 days = %d, want 404", status)
	}
}

// The inbound route takes a body up to its limit, which fits notes of
// alerts.MaxNotesBytes, and refuses one byte more; notes over MaxNotesBytes
// are refused though their base64 is no longer.
func TestInboundTakesABodyUpToItsLimitAndRefusesALargerOne(t *testing.T) {
	s, _, _, sermons := twoPhones(t)
	token := tokenOf(s.address(t, sermons))
	body := func(pdf []byte, size int) string {
		head := fmt.Sprintf(`{"token":%q,"kind":"sermon-notes","title":"Grace",`, token)
		tail := fmt.Sprintf(`"notes":%q}`, base64.StdEncoding.EncodeToString(pdf))
		pad := size - len(head) - len(tail)
		if pad < 0 {
			t.Fatalf("a body of %d bytes cannot hold these notes", size)
		}
		return head + strings.Repeat(" ", pad) + tail
	}
	atLimit := notesPDF(alerts.MaxNotesBytes)
	if status, out := s.inbound(t, alertsSecret, body(atLimit, maxInboundBodyBytes)); status != http.StatusCreated {
		t.Fatalf("a body of the limit, %d bytes = %d %.200s, want 201", maxInboundBodyBytes, status, out)
	}
	if status, _ := s.inbound(t, alertsSecret, body(atLimit, maxInboundBodyBytes+1)); status != http.StatusBadRequest {
		t.Fatalf("a body one byte over the limit = %d, want 400", status)
	}
	if status, _ := s.inbound(t, alertsSecret, body(notesPDF(alerts.MaxNotesBytes+1), maxInboundBodyBytes)); status != http.StatusBadRequest {
		t.Fatalf("notes one byte over MaxNotesBytes = %d, want 400", status)
	}
	if got := s.list(t, sermons, 0).Alerts; len(got) != 1 || got[0].NotesSize != alerts.MaxNotesBytes {
		t.Fatalf("the feed = %+v, want the one alert at the limit", got)
	}
	// the limit is the alert's 16 KiB and the base64 of the notes, no more
	if want := maxAlertBodyBytes + base64.StdEncoding.EncodedLen(alerts.MaxNotesBytes); maxInboundBodyBytes != want {
		t.Fatalf("maxInboundBodyBytes = %d, want %d", maxInboundBodyBytes, want)
	}
}

// The receiver's token check still answers beside the notes route, which
// shares its path's shape: only /api/alerts/inbound/{token} is the check.
func TestTheTokenCheckAndTheNotesRouteShareTheirShapeApart(t *testing.T) {
	s, _, _, sermons := twoPhones(t)
	token := tokenOf(s.address(t, sermons))
	if status, out := s.tokenCheck(t, alertsSecret, token); status != http.StatusNoContent {
		t.Fatalf("the token check = %d %s, want 204", status, out)
	}
	req, _ := http.NewRequest(http.MethodGet, s.URL+"/api/alerts/elsewhere/"+token, nil)
	req.Header.Set("Authorization", "Bearer "+alertsSecret)
	if status, _ := doRaw(t, req); status != http.StatusNotFound {
		t.Fatalf("GET /api/alerts/elsewhere/{token} = %d, want 404", status)
	}
	if status, _, _ := s.notes(t, sermons, "inbound"); status != http.StatusNotFound {
		t.Fatalf("GET /api/alerts/inbound/notes as a key = %d, want 404", status)
	}
}

// A Subsplash notes mail goes through the receiver's parse and its real post
// to the real inbound handler, and the notes read back are its PDF's bytes.
func TestANotesMailThroughTheReceiverServesItsPDF(t *testing.T) {
	raw, err := os.ReadFile("../alertsmail/testdata/subsplash-notes.eml")
	if err != nil {
		t.Fatal(err)
	}
	facts := alertsmail.Parse(raw)
	if facts.Kind != "sermon-notes" || facts.Notes == "" {
		t.Fatalf("the parse gave kind %q and %d bytes of notes (%s), want sermon-notes with notes", facts.Kind, len(facts.Notes), facts.NotesWhy)
	}
	solo, soloPub := newKey(t)
	s := newAlertsServer(t, []string{soloPub}, nil, alertsSecret)
	inbound := &alertsmail.HTTPInbound{URL: s.URL, Secret: alertsSecret}
	if err := inbound.Post(context.Background(), tokenOf(s.address(t, solo)), facts.Alert()); err != nil {
		t.Fatalf("Post = %v", err)
	}
	list := s.list(t, solo, 0).Alerts
	sum := sha256.Sum256([]byte(facts.Notes))
	if len(list) != 1 || list[0].NotesSHA256 != hex.EncodeToString(sum[:]) || list[0].NotesSize != len(facts.Notes) {
		t.Fatalf("feed = %+v, want the notes' sha256 and size", list)
	}
	if status, got, _ := s.notes(t, solo, list[0].ID); status != http.StatusOK || string(got) != facts.Notes {
		t.Fatalf("GET notes = %d, %d bytes; want the PDF's %d", status, len(got), len(facts.Notes))
	}
}

// Only an alert a phone has something to do with is pushed: a charge (to sort) and Gmail's
// forwarding confirmation (to tap). Every other kind is stored and listed, and no phone is pinged
// for it: the Governor's Amazon order mail pinged "A new charge to sort" with nothing to sort
// (mw-mr4xgrw.48).
func TestAnAlertNoPhoneCanActOnIsStoredAndListedButNotPushed(t *testing.T) {
	cases := []struct {
		kind, fields string
		pushed       bool
	}{
		{"charge", `"amount":"9.99","merchant":"Hardware Store","last4":"4321"`, true},
		{"forward-confirm", `"code":"123456"`, true},
		{"hold", `"amount":"1.00","merchant":"COSTCO GAS #0304 BROOKFIELD US","last4":"4321"`, false},
		{"amazon", `"merchant":"Amazon","amount":"0.00"`, false},
		{"zelle-sent", `"merchant":"A Payee","amount":"20.00","last4":"1234"`, false},
		{"deposit", `"merchant":"An Employer","amount":"100.00","last4":"1234"`, false},
		{"unread", `"subject":"Something we could not read"`, false},
		{"sermon-notes", `"title":"The Day of the Lord","reference":"2 Peter 3:10-18"`, false},
	}
	for _, c := range cases {
		t.Run(c.kind, func(t *testing.T) {
			s, keys, pubs, _ := twoPhones(t)
			s.subscribe(t, keys[0], pubs[0], "phone-0")
			s.subscribeCards(t, keys[1], pubs[1], "phone-1", `["4321"]`)
			address := s.address(t, keys[0])
			if status, body := s.inbound(t, alertsSecret, fmt.Sprintf(`{"token":%q,"kind":%q,%s}`, tokenOf(address), c.kind, c.fields)); status != http.StatusCreated {
				t.Fatalf("inbound = %d %s", status, body)
			}
			want := int32(0)
			if c.pushed {
				want = 2
			}
			if got := s.pushes.Load(); got != want {
				t.Fatalf("a %s alert made %d pushes, want %d", c.kind, got, want)
			}
			if list := s.list(t, keys[0], 0).Alerts; len(list) != 1 || list[0].Kind != c.kind {
				t.Fatalf("the feed after a %s alert = %+v, want that one alert", c.kind, list)
			}
		})
	}
}

// mw-mr4xgrw.51 sweep: every kind pushesKind lets through reaches the sender naming itself, so a kind
// added to pushesKind later without the kind in the facts (and so in the payload) fails here.
func TestEveryKindThatPushesCarriesItsKindToThePusher(t *testing.T) {
	pushed := 0
	for _, kind := range alerts.Kinds {
		if !pushesKind(kind) {
			continue
		}
		pushed++
		if got := alertFacts(alerts.Alert{ID: "a-1", Kind: kind}).Kind; got != kind {
			t.Fatalf("a %s alert is pushed with kind %q, want %q", kind, got, kind)
		}
	}
	if pushed < 2 {
		t.Fatalf("only %d kinds push; charge and forward-confirm both should", pushed)
	}
}
