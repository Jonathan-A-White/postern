package api

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/auth"
	"github.com/Jonathan-A-White/postern/server/internal/register"
	"github.com/btcsuite/btcd/btcec/v2"
)

// Self-registration (the Lampas epic, mw-cvwm1u): open endpoints, so the proof
// of a licence is not what they ask.

const (
	regEmail = "ada@example.com"
	regPhone = "+14155550101"
)

type regVerifier struct{}

func (regVerifier) Start(context.Context, register.Channel, string) error { return nil }
func (regVerifier) Check(_ context.Context, channel register.Channel, _, code string) (bool, error) {
	if channel == register.ChannelSMS {
		return code == "222222", nil
	}
	return code == "111111", nil
}

type regClock struct{ now time.Time }

func (c *regClock) Now() time.Time { return c.now }

func newRegistrationServer(t *testing.T, opts ...register.Option) (string, *regClock) {
	t.Helper()
	clock := &regClock{now: time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)}
	svc, err := register.Open(t.TempDir(), append([]register.Option{register.WithClock(clock.Now)}, opts...)...)
	if err != nil {
		t.Fatalf("register.Open: %v", err)
	}
	server, _ := newServerWithOptions(t, WithRegistration(svc, "X-Real-IP"))
	return server.URL, clock
}

func regPost(t *testing.T, url, path, ip string, body any) (int, map[string]any) {
	t.Helper()
	raw, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost, url+path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	if ip != "" {
		req.Header.Set("X-Real-IP", ip)
	}
	return regDo(t, req)
}

func regDo(t *testing.T, req *http.Request) (int, map[string]any) {
	t.Helper()
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	var out map[string]any
	_ = json.Unmarshal(data, &out)
	return resp.StatusCode, out
}

func regKey(n byte) string { return "03" + strings.Repeat(string([]byte{'a' + n}), 64) }

func TestRegisterStartThenConfirmAnswersThePerson(t *testing.T) {
	url, _ := newRegistrationServer(t, register.WithVerifier(regVerifier{}), register.WithIssuer(&regIssuer{}))
	status, started := regPost(t, url, "/api/register/start", "", map[string]string{"email": regEmail, "phone": regPhone, "deviceKey": regKey(0)})
	id, _ := started["registrationId"].(string)
	if status != http.StatusOK || id == "" {
		t.Fatalf("start = %d %v", status, started)
	}
	status, confirmed := regPost(t, url, "/api/register/confirm", "", map[string]string{"registrationId": id, "emailCode": "111111", "phoneCode": "222222"})
	devices, _ := confirmed["devices"].([]any)
	if status != http.StatusOK || confirmed["personId"] == "" || len(devices) != 1 || confirmed["issued"] != true {
		t.Fatalf("confirm = %d %v", status, confirmed)
	}
	device := devices[0].(map[string]any)
	if device["key"] != regKey(0) || device["name"] == "" || device["addedAt"] == "" {
		t.Fatalf("device = %v", device)
	}
}

func TestRegisterRefusalsAreConflicts(t *testing.T) {
	url, clock := newRegistrationServer(t, register.WithVerifier(regVerifier{}), register.WithIssuer(&regIssuer{}))
	confirm := func(email, phone string, key byte) (int, map[string]any) {
		_, started := regPost(t, url, "/api/register/start", "", map[string]string{"email": email, "phone": phone, "deviceKey": regKey(key)})
		id, _ := started["registrationId"].(string)
		return regPost(t, url, "/api/register/confirm", "", map[string]string{"registrationId": id, "emailCode": "111111", "phoneCode": "222222"})
	}
	if status, body := confirm(regEmail, regPhone, 0); status != 200 {
		t.Fatalf("first = %d %v", status, body)
	}
	status, body := confirm(regEmail, "+14155550199", 1)
	if status != http.StatusConflict || body["error"] != "that email is already registered" {
		t.Fatalf("known email = %d %v", status, body)
	}
	confirm("b@example.com", regPhone, 2)
	confirm("c@example.com", regPhone, 3)
	clock.now = clock.now.Add(time.Hour) // a phone has codes sent at most 3 times an hour (mw-cvwm1u.9)
	confirm("d@example.com", regPhone, 4)
	confirm("e@example.com", regPhone, 5)
	status, body = confirm("f@example.com", regPhone, 1) // key 1 was refused above, so it joined nothing
	if status != http.StatusConflict || body["error"] != "This licence already has 5 devices. Remove one first." {
		t.Fatalf("sixth = %d %v", status, body)
	}
}

func TestRegisterWrongCodeIsA400WithTriesLeftThenGone(t *testing.T) {
	url, _ := newRegistrationServer(t, register.WithVerifier(regVerifier{}), register.WithIssuer(&regIssuer{}))
	_, started := regPost(t, url, "/api/register/start", "", map[string]string{"email": regEmail, "phone": regPhone, "deviceKey": regKey(0)})
	id := started["registrationId"].(string)
	status, body := regPost(t, url, "/api/register/confirm", "", map[string]string{"registrationId": id, "emailCode": "000000", "phoneCode": "222222"})
	if status != http.StatusBadRequest || body["triesLeft"] != float64(4) {
		t.Fatalf("wrong code = %d %v", status, body)
	}
	for i := 0; i < 4; i++ {
		regPost(t, url, "/api/register/confirm", "", map[string]string{"registrationId": id, "emailCode": "000000", "phoneCode": "222222"})
	}
	status, _ = regPost(t, url, "/api/register/confirm", "", map[string]string{"registrationId": id, "emailCode": "111111", "phoneCode": "222222"})
	if status != http.StatusGone {
		t.Fatalf("after five wrong codes = %d, want 410", status)
	}
}

func TestRegisterBadInputIs400(t *testing.T) {
	url, _ := newRegistrationServer(t, register.WithVerifier(regVerifier{}), register.WithIssuer(&regIssuer{}))
	status, body := regPost(t, url, "/api/register/start", "", map[string]string{"email": "nope", "phone": regPhone, "deviceKey": regKey(0)})
	if status != http.StatusBadRequest || body["error"] == "" {
		t.Fatalf("bad email = %d %v", status, body)
	}
	req, _ := http.NewRequest(http.MethodPost, url+"/api/register/start", strings.NewReader("{not json"))
	if status, _ := regDo(t, req); status != http.StatusBadRequest {
		t.Fatalf("bad json = %d", status)
	}
}

func TestRegisterEleventhStartFromOneIPInAnHourIs429(t *testing.T) {
	url, clock := newRegistrationServer(t, register.WithVerifier(regVerifier{}), register.WithIssuer(&regIssuer{}))
	n := 0
	start := func(ip string) int {
		n++ // each start to a destination of its own: a destination has its own limit (mw-cvwm1u.9)
		status, _ := regPost(t, url, "/api/register/start", ip, map[string]string{"email": fmt.Sprintf("s%d@example.com", n), "phone": fmt.Sprintf("+1415555%04d", 100+n), "deviceKey": regKey(0)})
		return status
	}
	for i := 1; i <= 10; i++ {
		if status := start("198.51.100.7"); status != http.StatusOK {
			t.Fatalf("start %d = %d", i, status)
		}
	}
	if status := start("198.51.100.7"); status != http.StatusTooManyRequests {
		t.Fatalf("11th start = %d, want 429", status)
	}
	if status := start("198.51.100.8"); status != http.StatusOK {
		t.Fatalf("another IP = %d, want 200", status)
	}
	clock.now = clock.now.Add(61 * time.Minute)
	if status := start("198.51.100.7"); status != http.StatusOK {
		t.Fatalf("an hour later = %d, want 200", status)
	}
}

func TestRegisterConfirmsAreLimitedToo(t *testing.T) {
	url, _ := newRegistrationServer(t, register.WithVerifier(regVerifier{}), register.WithIssuer(&regIssuer{}), register.WithLimits(10, 3))
	var last int
	for i := 0; i < 4; i++ {
		last, _ = regPost(t, url, "/api/register/confirm", "198.51.100.7", map[string]string{"registrationId": "x", "emailCode": "1", "phoneCode": "2"})
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("4th confirm = %d, want 429", last)
	}
}

func TestRegisterWithoutTwilioIsClosedAndTheRestOfTheBackendIsNot(t *testing.T) {
	url, _ := newRegistrationServer(t) // no verifier: no Twilio env
	status, body := regPost(t, url, "/api/register/start", "", map[string]string{"email": regEmail, "phone": regPhone, "deviceKey": regKey(0)})
	if status != http.StatusServiceUnavailable || body["error"] != "registration closed" {
		t.Fatalf("start = %d %v, want 503 registration closed", status, body)
	}
	status, body = regPost(t, url, "/api/register/confirm", "", map[string]string{"registrationId": "x", "emailCode": "1", "phoneCode": "2"})
	if status != http.StatusServiceUnavailable {
		t.Fatalf("confirm = %d %v, want 503", status, body)
	}
	for _, path := range []string{"/healthz", "/api/challenge"} {
		resp, err := http.Get(url + path)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Errorf("GET %s = %d, want 200", path, resp.StatusCode)
		}
	}
	// A backend built with no registration at all is closed the same way.
	bare, _ := newServerWithOptions(t)
	if status, _ := regPost(t, bare.URL, "/api/register/start", "", map[string]string{}); status != http.StatusServiceUnavailable {
		t.Fatalf("no registration wired: start = %d, want 503", status)
	}
}

func TestRegisterPersonLookup(t *testing.T) {
	mill, millPub := newKey(t)
	svc, err := register.Open(t.TempDir(), register.WithVerifier(regVerifier{}), register.WithIssuer(&regIssuer{}))
	if err != nil {
		t.Fatal(err)
	}
	server, _ := newServerWithOptions(t, WithRegistration(svc, "X-Real-IP"), WithGrist(millPub, nil))
	get := func(key string) (int, map[string]any) {
		req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/register/person?key="+key, nil)
		signRequest(t, server, mill, req)
		return regDo(t, req)
	}
	status, body := get(regKey(0))
	if status != 200 || body["known"] != false || len(body) != 1 {
		t.Fatalf("stranger = %d %v, want only known:false", status, body)
	}
	for i, email := range []string{"a@example.com", "b@example.com"} {
		_, started := regPost(t, server.URL, "/api/register/start", "", map[string]string{"email": email, "phone": regPhone, "deviceKey": regKey(byte(i))})
		regPost(t, server.URL, "/api/register/confirm", "", map[string]string{"registrationId": started["registrationId"].(string), "emailCode": "111111", "phoneCode": "222222"})
	}
	status, body = get(regKey(1))
	keys, _ := body["keys"].([]any)
	if status != 200 || body["known"] != true || body["personId"] == "" || len(keys) != 2 || body["dailyLimit"] != float64(50) {
		t.Fatalf("registered = %d %v", status, body)
	}
	if status, body = get("not-a-key"); status != 200 || body["known"] != false {
		t.Fatalf("malformed key = %d %v", status, body)
	}
}

func TestRegisterLogsNeitherEmailNorPhone(t *testing.T) {
	var logged bytes.Buffer
	log.SetOutput(&logged)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	url, _ := newRegistrationServer(t, register.WithVerifier(regVerifier{}), register.WithIssuer(&regIssuer{}))
	_, started := regPost(t, url, "/api/register/start", "", map[string]string{"email": regEmail, "phone": regPhone, "deviceKey": regKey(0)})
	regPost(t, url, "/api/register/confirm", "", map[string]string{"registrationId": started["registrationId"].(string), "emailCode": "0", "phoneCode": "222222"})
	regPost(t, url, "/api/register/start", "", map[string]string{"email": "bad", "phone": regPhone, "deviceKey": regKey(0)})
	for _, secret := range []string{"ada@example.com", "example.com", "4155550101"} {
		if strings.Contains(logged.String(), secret) {
			t.Errorf("the log holds %q: %s", secret, logged.String())
		}
	}
}

func TestRegisterTakesTheClientIPFromTheNamedHeaderOnly(t *testing.T) {
	// With no header named, every caller is the peer address; the header is
	// not trusted, so a caller cannot dodge the limit by changing it.
	svc, err := register.Open(t.TempDir(), register.WithVerifier(regVerifier{}), register.WithIssuer(&regIssuer{}), register.WithLimits(2, 30))
	if err != nil {
		t.Fatal(err)
	}
	server, _ := newServerWithOptions(t, WithRegistration(svc, ""))
	var last int
	for i := 0; i < 3; i++ {
		last, _ = regPost(t, server.URL, "/api/register/start", "198.51.100."+string(rune('1'+i)), map[string]string{"email": regEmail, "phone": regPhone, "deviceKey": regKey(0)})
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("3rd start with a changing header = %d, want 429", last)
	}
}

// regIssuer stands in for the site issuer: every licence a txid of its own,
// and the origins it was asked to revoke.
type regIssuer struct {
	mu      sync.Mutex
	issued  int
	revoked []string
}

func (r *regIssuer) Issue(string) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.issued++
	return fmt.Sprintf("%064x", r.issued), nil
}

func (r *regIssuer) Revoke(origin string) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.revoked = append(r.revoked, origin)
	return strings.Repeat("e", 64), nil
}

// AC3 (mw-cvwm1u.3): Twilio is set but the site issuer key is not, so
// registration says the licence is by hand, and the rest goes on.
func TestRegisterWithoutTheSiteIssuerKeyIsLicensedByHand(t *testing.T) {
	url, _ := newRegistrationServer(t, register.WithVerifier(regVerifier{}))
	status, body := regPost(t, url, "/api/register/start", "", map[string]string{"email": regEmail, "phone": regPhone, "deviceKey": regKey(0)})
	if status != http.StatusServiceUnavailable || body["error"] != "licensed by hand: ask the Governor" {
		t.Fatalf("start = %d %v, want 503 licensed by hand", status, body)
	}
	status, body = regPost(t, url, "/api/register/confirm", "", map[string]string{"registrationId": "x", "emailCode": "111111", "phoneCode": "222222"})
	if status != http.StatusServiceUnavailable || body["error"] != "licensed by hand: ask the Governor" {
		t.Fatalf("confirm = %d %v, want 503 licensed by hand", status, body)
	}
	for _, path := range []string{"/healthz", "/api/challenge"} {
		resp, err := http.Get(url + path)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Errorf("GET %s = %d, want 200", path, resp.StatusCode)
		}
	}
}

// AC2 (mw-cvwm1u.3): DELETE /api/register/device, signed by a device of the
// same person, revokes the other's licence and frees its slot.
func TestRegisterDeleteDeviceRevokesAndFreesTheSlot(t *testing.T) {
	issuer := &regIssuer{}
	svc, err := register.Open(t.TempDir(), register.WithVerifier(regVerifier{}), register.WithIssuer(issuer), register.WithSendLimits(10, 10, 0))
	if err != nil {
		t.Fatal(err)
	}
	server, _ := newServerWithOptions(t, WithRegistration(svc, ""))
	keys := make([]*btcec.PrivateKey, 6)
	pubs := make([]string, 6)
	for i := range keys {
		keys[i], _ = btcec.NewPrivateKey()
		pubs[i] = hex.EncodeToString(keys[i].PubKey().SerializeCompressed())
	}
	join := func(i int) (int, map[string]any) {
		_, started := regPost(t, server.URL, "/api/register/start", "", map[string]string{"email": fmt.Sprintf("d%d@example.com", i), "phone": regPhone, "deviceKey": pubs[i]})
		return regPost(t, server.URL, "/api/register/confirm", "", map[string]string{"registrationId": started["registrationId"].(string), "emailCode": "111111", "phoneCode": "222222"})
	}
	var person string
	var second map[string]any
	for i := 0; i < 5; i++ {
		status, body := join(i)
		if status != http.StatusOK {
			t.Fatalf("join %d = %d %v", i, status, body)
		}
		person = body["personId"].(string)
		if i == 1 {
			second = body["devices"].([]any)[1].(map[string]any)
		}
	}
	if status, body := join(5); status != http.StatusConflict || body["error"] != "This licence already has 5 devices. Remove one first." {
		t.Fatalf("sixth = %d %v, want 409", status, body)
	}

	remove := func(signer *btcec.PrivateKey, deviceKey string) (int, map[string]any) {
		raw, _ := json.Marshal(map[string]string{"deviceKey": deviceKey, "personId": person})
		req, _ := http.NewRequest(http.MethodDelete, server.URL+"/api/register/device", bytes.NewReader(raw))
		if signer != nil {
			signRequest(t, server, signer, req)
		}
		return regDo(t, req)
	}
	if status, _ := remove(nil, pubs[1]); status != http.StatusUnauthorized {
		t.Fatalf("unsigned = %d, want 401", status)
	}
	stranger, _ := btcec.NewPrivateKey()
	if status, _ := remove(stranger, pubs[1]); status != http.StatusForbidden {
		t.Fatalf("a stranger = %d, want 403", status)
	}
	status, body := remove(keys[0], pubs[1])
	devices, _ := body["devices"].([]any)
	if status != http.StatusOK || len(devices) != 4 {
		t.Fatalf("remove = %d %v, want 200 and four devices", status, body)
	}
	if want := second["licenceTxid"].(string) + ":0"; len(issuer.revoked) != 1 || issuer.revoked[0] != want {
		t.Fatalf("revoked %v, want %s", issuer.revoked, want)
	}
	if status, body := remove(keys[0], pubs[1]); status != http.StatusNotFound {
		t.Fatalf("remove again = %d %v, want 404", status, body)
	}
	if status, body := join(5); status != http.StatusOK {
		t.Fatalf("sixth after a removal = %d %v, want 200", status, body)
	}
}

// countingVerifier is regVerifier that remembers each "channel:to" it was
// asked to send a code to.
type countingVerifier struct {
	regVerifier
	mu   sync.Mutex
	sent []string
}

func (c *countingVerifier) Start(_ context.Context, channel register.Channel, to string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sent = append(c.sent, string(channel)+":"+to)
	return nil
}

func (c *countingVerifier) sentTo(dest string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	n := 0
	for _, s := range c.sent {
		if s == dest {
			n++
		}
	}
	return n
}

// AC1 (mw-cvwm1u.9): rotating IPs cannot pump SMS. The 4th start in an hour
// to one phone, or to one email, from 4 different IPs is 429 and Twilio sends
// 3; a new destination still starts; the global send cap refuses the next
// start with 429; no log line holds an address.
func TestRegisterStartsAreLimitedPerDestinationAndInAll(t *testing.T) {
	var logged bytes.Buffer
	log.SetOutput(&logged)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	v := &countingVerifier{}
	url, _ := newRegistrationServer(t, register.WithVerifier(v), register.WithIssuer(&regIssuer{}))
	start := func(ip, email, phone string) (int, map[string]any) {
		return regPost(t, url, "/api/register/start", ip, map[string]string{"email": email, "phone": phone, "deviceKey": regKey(0)})
	}
	for i := 1; i <= 3; i++ {
		if status, body := start(fmt.Sprintf("198.51.100.%d", i), fmt.Sprintf("p%d@example.com", i), regPhone); status != http.StatusOK {
			t.Fatalf("start %d to the phone = %d %v", i, status, body)
		}
	}
	if status, body := start("198.51.100.4", "p4@example.com", regPhone); status != http.StatusTooManyRequests || body["error"] == "" {
		t.Fatalf("4th start to the phone from a 4th IP = %d %v, want 429", status, body)
	}
	if n := v.sentTo("sms:" + regPhone); n != 3 {
		t.Fatalf("Twilio sent %d codes to the phone, want 3", n)
	}
	for i := 1; i <= 3; i++ {
		if status, body := start(fmt.Sprintf("203.0.113.%d", i), regEmail, fmt.Sprintf("+1415555%04d", 600+i)); status != http.StatusOK {
			t.Fatalf("start %d to the email = %d %v", i, status, body)
		}
	}
	if status, _ := start("203.0.113.4", regEmail, "+14155550604"); status != http.StatusTooManyRequests {
		t.Fatalf("4th start to the email from a 4th IP = %d, want 429", status)
	}
	if n := v.sentTo("email:" + regEmail); n != 3 {
		t.Fatalf("Twilio sent %d codes to the email, want 3", n)
	}
	if status, body := start("192.0.2.1", "new@example.com", "+14155550700"); status != http.StatusOK {
		t.Fatalf("a new destination = %d %v, want 200", status, body)
	}

	// The global cap: a knob, here 2 an hour.
	capped := &countingVerifier{}
	capURL, _ := newRegistrationServer(t, register.WithVerifier(capped), register.WithIssuer(&regIssuer{}), register.WithSendLimits(0, 0, 2))
	for i := 1; i <= 3; i++ {
		status, body := regPost(t, capURL, "/api/register/start", fmt.Sprintf("192.0.2.%d", i), map[string]string{"email": fmt.Sprintf("c%d@example.com", i), "phone": fmt.Sprintf("+1415555%04d", 800+i), "deviceKey": regKey(0)})
		want := http.StatusOK
		if i == 3 {
			want = http.StatusTooManyRequests
		}
		if status != want {
			t.Fatalf("start %d under a cap of 2 = %d %v, want %d", i, status, body, want)
		}
	}
	if len(capped.sent) != 4 {
		t.Fatalf("Twilio sent %v under a cap of 2 starts, want 4 codes", capped.sent)
	}
	for _, secret := range []string{"example.com", "4155550"} {
		if strings.Contains(logged.String(), secret) {
			t.Errorf("the log holds %q: %s", secret, logged.String())
		}
	}
}

// AC2 (mw-cvwm1u.9): GET /api/register/person links a person's devices, so
// it answers only the mill's key, or one of that person's own device keys for
// that person; anyone else learns nothing, the same for a registered key as
// for an unknown one.
func TestRegisterPersonAnswersOnlyTheMillOrThePersonsOwnDevices(t *testing.T) {
	mill, millPub := newKey(t)
	svc, err := register.Open(t.TempDir(), register.WithVerifier(regVerifier{}), register.WithIssuer(&regIssuer{}))
	if err != nil {
		t.Fatal(err)
	}
	server, _ := newServerWithOptions(t, WithRegistration(svc, "X-Real-IP"), WithGrist(millPub, nil))
	a0, a0Pub := newKey(t)
	_, a1Pub := newKey(t)
	b0, b0Pub := newKey(t)
	stranger, _ := newKey(t)
	_, unknownPub := newKey(t)
	for _, join := range []struct{ email, phone, key string }{
		{"a0@example.com", regPhone, a0Pub},
		{"a1@example.com", regPhone, a1Pub},
		{"b0@example.com", "+14155550999", b0Pub},
	} {
		_, started := regPost(t, server.URL, "/api/register/start", "", map[string]string{"email": join.email, "phone": join.phone, "deviceKey": join.key})
		if status, body := regPost(t, server.URL, "/api/register/confirm", "", map[string]string{"registrationId": started["registrationId"].(string), "emailCode": "111111", "phoneCode": "222222"}); status != http.StatusOK {
			t.Fatalf("join %s = %d %v", join.email, status, body)
		}
	}
	get := func(signer *btcec.PrivateKey, key string) (int, string) {
		req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/register/person?key="+key, nil)
		if signer != nil {
			signRequest(t, server, signer, req)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		data, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(data)
	}

	// Unsigned: 401, the same for a registered key and an unknown one.
	regStatus, regBody := get(nil, a0Pub)
	unkStatus, unkBody := get(nil, unknownPub)
	if regStatus != http.StatusUnauthorized || unkStatus != regStatus || unkBody != regBody || strings.Contains(regBody, "personId") {
		t.Fatalf("unsigned: registered = %d %s, unknown = %d %s; want the same 401", regStatus, regBody, unkStatus, unkBody)
	}
	// Signed by a key that is no one's device: 403, the same for both.
	regStatus, regBody = get(stranger, a0Pub)
	unkStatus, unkBody = get(stranger, unknownPub)
	if regStatus != http.StatusForbidden || unkStatus != regStatus || unkBody != regBody || strings.Contains(regBody, "personId") {
		t.Fatalf("a stranger: registered = %d %s, unknown = %d %s; want the same 403", regStatus, regBody, unkStatus, unkBody)
	}
	// Another person's device may not ask after this one, nor the other way.
	if status, body := get(b0, a0Pub); status != http.StatusForbidden || strings.Contains(body, "personId") {
		t.Fatalf("b0 asking for a0 = %d %s, want 403", status, body)
	}
	if status, body := get(a0, b0Pub); status != http.StatusForbidden || strings.Contains(body, "personId") {
		t.Fatalf("a0 asking for b0 = %d %s, want 403", status, body)
	}
	if status, body := get(a0, unknownPub); status != http.StatusForbidden {
		t.Fatalf("a0 asking for an unknown key = %d %s, want 403", status, body)
	}
	// One of the person's own devices sees the person, itself included.
	for _, key := range []string{a1Pub, a0Pub} {
		status, body := get(a0, key)
		var out struct {
			Known    bool     `json:"known"`
			PersonID string   `json:"personId"`
			Keys     []string `json:"keys"`
		}
		if status != http.StatusOK || json.Unmarshal([]byte(body), &out) != nil || !out.Known || out.PersonID == "" || len(out.Keys) != 2 {
			t.Fatalf("a0 asking for %s = %d %s, want its person with two keys", key[:8], status, body)
		}
	}
	// The mill answers as before, an unknown key too.
	if status, body := get(mill, b0Pub); status != http.StatusOK || !strings.Contains(body, `"known":true`) {
		t.Fatalf("the mill = %d %s", status, body)
	}
	if status, body := get(mill, unknownPub); status != http.StatusOK || body != "{\"known\":false}\n" {
		t.Fatalf("the mill, an unknown key = %d %q", status, body)
	}
}

// AC3 (mw-cvwm1u.9): once the nonce store is full a signed request is 429,
// not a store that grows without end.
func TestASignedRequestIs429WhenTheNonceStoreIsFull(t *testing.T) {
	server, _ := newServerWithNonces(t, auth.NewNonceStore(time.Minute, auth.WithMaxSpent(2)))
	key, _ := newKey(t)
	statuses := []int{}
	var last map[string]any
	for i := 0; i < 3; i++ {
		req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/me", nil)
		signRequest(t, server, key, req)
		var status int
		status, last = regDo(t, req)
		statuses = append(statuses, status)
	}
	if statuses[0] != http.StatusOK || statuses[1] != http.StatusOK || statuses[2] != http.StatusTooManyRequests || last["reason"] != "busy" {
		t.Fatalf("statuses = %v, last = %v; want 200, 200, then 429 reason busy", statuses, last)
	}
}

// joinedPair registers two devices of one person (keys a0, a1) and one of
// another (b0) on a server whose registration clock the test moves.
type joinedPair struct {
	server        *httptest.Server
	clock         *regClock
	person        string
	a0, a1, b0    *btcec.PrivateKey
	a0Pub, a1Pub  string
	b0Pub         string
	a0Person      map[string]any
	stranger      *btcec.PrivateKey
	unknownDevice string
}

func newJoinedPair(t *testing.T) *joinedPair {
	t.Helper()
	clock := &regClock{now: time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)}
	svc, err := register.Open(t.TempDir(), register.WithClock(clock.Now), register.WithVerifier(regVerifier{}), register.WithIssuer(&regIssuer{}), register.WithSendLimits(5, 10, 0))
	if err != nil {
		t.Fatal(err)
	}
	server, _ := newServerWithOptions(t, WithRegistration(svc, ""))
	p := &joinedPair{server: server, clock: clock}
	p.a0, p.a0Pub = newKey(t)
	p.a1, p.a1Pub = newKey(t)
	p.b0, p.b0Pub = newKey(t)
	p.stranger, _ = newKey(t)
	_, p.unknownDevice = newKey(t)
	for i, join := range []struct{ email, phone, key string }{
		{"a0@example.com", regPhone, p.a0Pub},
		{"a1@example.com", regPhone, p.a1Pub},
		{"b0@example.com", "+14155550999", p.b0Pub},
	} {
		_, started := regPost(t, server.URL, "/api/register/start", "", map[string]string{"email": join.email, "phone": join.phone, "deviceKey": join.key})
		status, body := regPost(t, server.URL, "/api/register/confirm", "", map[string]string{"registrationId": started["registrationId"].(string), "emailCode": "111111", "phoneCode": "222222"})
		if status != http.StatusOK {
			t.Fatalf("join %s = %d %v", join.email, status, body)
		}
		if i == 0 {
			p.person = body["personId"].(string)
		}
	}
	return p
}

func (p *joinedPair) call(t *testing.T, method, path string, signer *btcec.PrivateKey, body any) (int, map[string]any) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = bytes.NewReader(raw)
	}
	req, _ := http.NewRequest(method, p.server.URL+path, reader)
	if signer != nil {
		signRequest(t, p.server, signer, req)
	}
	return regDo(t, req)
}

func deviceNamed(t *testing.T, devices any, key string) map[string]any {
	t.Helper()
	list, _ := devices.([]any)
	for _, d := range list {
		if m, ok := d.(map[string]any); ok && m["key"] == key {
			return m
		}
	}
	t.Fatalf("no device %s in %v", key[:8], devices)
	return nil
}

// AC1 (mw-cvwm1u.16): PATCH /api/register/device {deviceKey, name}, signed by
// a device of the person, renames one of that person's devices.
func TestRegisterPatchDeviceRenamesADeviceOfTheSignersPerson(t *testing.T) {
	p := newJoinedPair(t)
	rename := func(signer *btcec.PrivateKey, key, name string) (int, map[string]any) {
		return p.call(t, http.MethodPatch, "/api/register/device", signer, map[string]string{"deviceKey": key, "name": name})
	}
	if status, _ := rename(nil, p.a1Pub, "Kitchen tablet"); status != http.StatusUnauthorized {
		t.Fatalf("unsigned = %d, want 401", status)
	}
	if status, _ := rename(p.stranger, p.a1Pub, "Kitchen tablet"); status != http.StatusForbidden {
		t.Fatalf("a stranger = %d, want 403", status)
	}
	if status, _ := rename(p.b0, p.a1Pub, "Kitchen tablet"); status != http.StatusForbidden {
		t.Fatalf("another person's device = %d, want 403", status)
	}
	if status, _ := rename(p.a0, p.b0Pub, "Kitchen tablet"); status != http.StatusForbidden {
		t.Fatalf("another person's device as the target = %d, want 403", status)
	}
	if status, body := rename(p.a0, p.unknownDevice, "Kitchen tablet"); status != http.StatusNotFound {
		t.Fatalf("an unknown device = %d %v, want 404", status, body)
	}
	for _, name := range []string{"", "   ", strings.Repeat("x", 81)} {
		if status, body := rename(p.a0, p.a1Pub, name); status != http.StatusBadRequest {
			t.Fatalf("name %q = %d %v, want 400", name, status, body)
		}
	}
	status, body := rename(p.a0, p.a1Pub, "  Kitchen tablet ")
	if status != http.StatusOK || body["personId"] != p.person {
		t.Fatalf("rename = %d %v, want 200 and the person", status, body)
	}
	if list, _ := body["devices"].([]any); len(list) != 2 {
		t.Fatalf("devices = %v, want two", body["devices"])
	}
	if got := deviceNamed(t, body["devices"], p.a1Pub)["name"]; got != "Kitchen tablet" {
		t.Fatalf("name = %v, want Kitchen tablet", got)
	}
	// A device may rename itself, and the name outlasts the answer.
	if status, _ := rename(p.a1, p.a1Pub, "Tablet"); status != http.StatusOK {
		t.Fatalf("rename itself = %d, want 200", status)
	}
	_, person := p.call(t, http.MethodGet, "/api/register/person?key="+p.a0Pub, p.a0, nil)
	if got := deviceNamed(t, person["devices"], p.a1Pub)["name"]; got != "Tablet" {
		t.Fatalf("person devices name = %v, want Tablet", got)
	}
}

// AC2 (mw-cvwm1u.16): GET /api/register/person carries each device's name,
// addedAt and lastSeen; lastSeen moves forward when the device's licence
// passes a gated route.
func TestRegisterPersonDevicesCarryNameAddedAtAndLastSeen(t *testing.T) {
	p := newJoinedPair(t)
	devices := func() (map[string]any, map[string]any) {
		t.Helper()
		status, body := p.call(t, http.MethodGet, "/api/register/person?key="+p.a0Pub, p.a0, nil)
		if status != http.StatusOK {
			t.Fatalf("person = %d %v", status, body)
		}
		if body["known"] != true || body["personId"] != p.person || body["dailyLimit"] == nil || len(body["keys"].([]any)) != 2 {
			t.Fatalf("person = %v, want known, personId, keys and dailyLimit as before", body)
		}
		return deviceNamed(t, body["devices"], p.a0Pub), deviceNamed(t, body["devices"], p.a1Pub)
	}
	first0, first1 := devices()
	for _, d := range []map[string]any{first0, first1} {
		if d["name"] == "" || d["addedAt"] == nil {
			t.Fatalf("device %v lacks a name or addedAt", d)
		}
		if _, licenceShown := d["licenceTxid"]; licenceShown {
			t.Fatalf("device %v shows its licence txid", d)
		}
	}
	// The person call is not a gated route: a0 has not been seen using a licence.
	if first0["lastSeen"] != nil || first1["lastSeen"] != nil {
		t.Fatalf("lastSeen before any use = %v, %v; want absent", first0["lastSeen"], first1["lastSeen"])
	}

	p.clock.now = p.clock.now.Add(2 * time.Hour)
	req, _ := http.NewRequest(http.MethodGet, p.server.URL+"/api/me", nil)
	signRequest(t, p.server, p.a1, req)
	if status, body := regDo(t, req); status != http.StatusOK {
		t.Fatalf("GET /api/me = %d %v", status, body)
	}
	second0, second1 := devices()
	if second1["lastSeen"] != p.clock.now.Format(time.RFC3339Nano) {
		t.Fatalf("a1 lastSeen = %v, want %s", second1["lastSeen"], p.clock.now.Format(time.RFC3339Nano))
	}
	if second0["lastSeen"] != nil {
		t.Fatalf("a0 lastSeen = %v, want absent (it used no licence)", second0["lastSeen"])
	}

	// Later use moves it forward.
	p.clock.now = p.clock.now.Add(3 * time.Hour)
	req, _ = http.NewRequest(http.MethodGet, p.server.URL+"/api/me", nil)
	signRequest(t, p.server, p.a1, req)
	regDo(t, req)
	if _, third1 := devices(); third1["lastSeen"] != p.clock.now.Format(time.RFC3339Nano) {
		t.Fatalf("a1 lastSeen = %v, want %s", third1["lastSeen"], p.clock.now.Format(time.RFC3339Nano))
	}
}
