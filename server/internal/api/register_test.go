package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/register"
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
	url, _ := newRegistrationServer(t, register.WithVerifier(regVerifier{}))
	status, started := regPost(t, url, "/api/register/start", "", map[string]string{"email": regEmail, "phone": regPhone, "deviceKey": regKey(0)})
	id, _ := started["registrationId"].(string)
	if status != http.StatusOK || id == "" {
		t.Fatalf("start = %d %v", status, started)
	}
	status, confirmed := regPost(t, url, "/api/register/confirm", "", map[string]string{"registrationId": id, "emailCode": "111111", "phoneCode": "222222"})
	devices, _ := confirmed["devices"].([]any)
	if status != http.StatusOK || confirmed["personId"] == "" || len(devices) != 1 || confirmed["issued"] != false {
		t.Fatalf("confirm = %d %v", status, confirmed)
	}
	device := devices[0].(map[string]any)
	if device["key"] != regKey(0) || device["name"] == "" || device["addedAt"] == "" {
		t.Fatalf("device = %v", device)
	}
}

func TestRegisterRefusalsAreConflicts(t *testing.T) {
	url, _ := newRegistrationServer(t, register.WithVerifier(regVerifier{}))
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
	status, body = confirm("d@example.com", regPhone, 4)
	if status != http.StatusConflict || body["error"] != "This licence already has 3 devices. Remove one first." {
		t.Fatalf("fourth = %d %v", status, body)
	}
}

func TestRegisterWrongCodeIsA400WithTriesLeftThenGone(t *testing.T) {
	url, _ := newRegistrationServer(t, register.WithVerifier(regVerifier{}))
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
	url, _ := newRegistrationServer(t, register.WithVerifier(regVerifier{}))
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
	url, clock := newRegistrationServer(t, register.WithVerifier(regVerifier{}))
	start := func(ip string) int {
		status, _ := regPost(t, url, "/api/register/start", ip, map[string]string{"email": regEmail, "phone": regPhone, "deviceKey": regKey(0)})
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
	url, _ := newRegistrationServer(t, register.WithVerifier(regVerifier{}), register.WithLimits(10, 3))
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
	url, _ := newRegistrationServer(t, register.WithVerifier(regVerifier{}))
	get := func(key string) (int, map[string]any) {
		req, _ := http.NewRequest(http.MethodGet, url+"/api/register/person?key="+key, nil)
		return regDo(t, req)
	}
	status, body := get(regKey(0))
	if status != 200 || body["known"] != false || len(body) != 1 {
		t.Fatalf("stranger = %d %v, want only known:false", status, body)
	}
	for i, email := range []string{"a@example.com", "b@example.com"} {
		_, started := regPost(t, url, "/api/register/start", "", map[string]string{"email": email, "phone": regPhone, "deviceKey": regKey(byte(i))})
		regPost(t, url, "/api/register/confirm", "", map[string]string{"registrationId": started["registrationId"].(string), "emailCode": "111111", "phoneCode": "222222"})
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
	url, _ := newRegistrationServer(t, register.WithVerifier(regVerifier{}))
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
	svc, err := register.Open(t.TempDir(), register.WithVerifier(regVerifier{}), register.WithLimits(2, 30))
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
