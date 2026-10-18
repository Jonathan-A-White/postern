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
	status, body = confirm("d@example.com", regPhone, 4)
	if status != http.StatusConflict || body["error"] != "This licence already has 3 devices. Remove one first." {
		t.Fatalf("fourth = %d %v", status, body)
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
	svc, err := register.Open(t.TempDir(), register.WithVerifier(regVerifier{}), register.WithIssuer(issuer), register.WithSendLimits(5, 10, 0))
	if err != nil {
		t.Fatal(err)
	}
	server, _ := newServerWithOptions(t, WithRegistration(svc, ""))
	keys := make([]*btcec.PrivateKey, 4)
	pubs := make([]string, 4)
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
	for i := 0; i < 3; i++ {
		status, body := join(i)
		if status != http.StatusOK {
			t.Fatalf("join %d = %d %v", i, status, body)
		}
		person = body["personId"].(string)
		if i == 1 {
			second = body["devices"].([]any)[1].(map[string]any)
		}
	}
	if status, _ := join(3); status != http.StatusConflict {
		t.Fatalf("fourth = %d, want 409", status)
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
	if status != http.StatusOK || len(devices) != 2 {
		t.Fatalf("remove = %d %v, want 200 and two devices", status, body)
	}
	if want := second["licenceTxid"].(string) + ":0"; len(issuer.revoked) != 1 || issuer.revoked[0] != want {
		t.Fatalf("revoked %v, want %s", issuer.revoked, want)
	}
	if status, body := remove(keys[0], pubs[1]); status != http.StatusNotFound {
		t.Fatalf("remove again = %d %v, want 404", status, body)
	}
	if status, body := join(3); status != http.StatusOK {
		t.Fatalf("fourth after a removal = %d %v, want 200", status, body)
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
