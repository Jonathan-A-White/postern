package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/Jonathan-A-White/postern/server/internal/register"
	"github.com/btcsuite/btcd/btcec/v2"
)

// mw-cvwm1u.22: the Governor marks a licence holder "API only" (billing
// "api", default "max"); GET /api/register/person answers it as billing.

type billingRig struct {
	url      string
	governor *btcec.PrivateKey
	mill     *btcec.PrivateKey
	// a0 and a1 are two devices of one registered person.
	a0, a1       *btcec.PrivateKey
	a0Pub, a1Pub string
	stranger     *btcec.PrivateKey
	strangerPub  string
	other        *btcec.PrivateKey
	call         func(method, path string, signer *btcec.PrivateKey, body any) (int, map[string]any)
}

func newBillingRig(t *testing.T) *billingRig {
	t.Helper()
	r := &billingRig{}
	var governorPub, millPub string
	r.governor, governorPub = newKey(t)
	r.mill, millPub = newKey(t)
	r.a0, r.a0Pub = newKey(t)
	r.a1, r.a1Pub = newKey(t)
	r.stranger, r.strangerPub = newKey(t)
	r.other, _ = newKey(t)
	svc, err := register.Open(t.TempDir(), register.WithVerifier(regVerifier{}), register.WithIssuer(&regIssuer{}), register.WithSendLimits(5, 10, 0))
	if err != nil {
		t.Fatal(err)
	}
	server, _ := newServerWithOptions(t,
		WithRegistration(svc, ""),
		WithGrist(millPub, nil),
		WithCatalogue([]string{"postern"}, nil, governorPub),
	)
	r.url = server.URL
	r.call = func(method, path string, signer *btcec.PrivateKey, body any) (int, map[string]any) {
		var reader *bytes.Reader
		if body != nil {
			raw, _ := json.Marshal(body)
			reader = bytes.NewReader(raw)
		} else {
			reader = bytes.NewReader(nil)
		}
		req, _ := http.NewRequest(method, server.URL+path, reader)
		if signer != nil {
			signRequest(t, server, signer, req)
		}
		return regDo(t, req)
	}
	for _, join := range []struct{ email, phone, key string }{
		{"a0@example.com", regPhone, r.a0Pub},
		{"a1@example.com", regPhone, r.a1Pub},
	} {
		_, started := regPost(t, server.URL, "/api/register/start", "", map[string]string{"email": join.email, "phone": join.phone, "deviceKey": join.key})
		if status, body := regPost(t, server.URL, "/api/register/confirm", "", map[string]string{"registrationId": started["registrationId"].(string), "emailCode": "111111", "phoneCode": "222222"}); status != http.StatusOK {
			t.Fatalf("join %s = %d %v", join.email, status, body)
		}
	}
	return r
}

func (r *billingRig) billingOf(t *testing.T, key string) any {
	t.Helper()
	status, body := r.call(http.MethodGet, "/api/register/person?key="+key, r.mill, nil)
	if status != http.StatusOK {
		t.Fatalf("the mill asking after %s = %d %v", key[:8], status, body)
	}
	return body["billing"]
}

// AC1: a person is max until marked, then api on every device, as billing.
func TestRegisterPersonAnswersBillingMaxUntilTheGovernorMarksItAPI(t *testing.T) {
	r := newBillingRig(t)
	if got := r.billingOf(t, r.a0Pub); got != "max" {
		t.Fatalf("billing = %v, want max by default", got)
	}
	if status, body := r.call(http.MethodPut, "/api/register/billing", r.governor, map[string]string{"key": r.a0Pub, "billing": "api"}); status != http.StatusOK || body["billing"] != "api" {
		t.Fatalf("the Governor's PUT = %d %v, want 200 with billing api", status, body)
	}
	for _, key := range []string{r.a0Pub, r.a1Pub} {
		if got := r.billingOf(t, key); got != "api" {
			t.Fatalf("billing of %s = %v, want api on both devices", key[:8], got)
		}
	}
	// A device of the person sees it too.
	if status, body := r.call(http.MethodGet, "/api/register/person?key="+r.a1Pub, r.a0, nil); status != http.StatusOK || body["billing"] != "api" {
		t.Fatalf("the person's own device reads %d %v, want billing api", status, body)
	}
	if status, _ := r.call(http.MethodPut, "/api/register/billing", r.governor, map[string]string{"key": r.a1Pub, "billing": "max"}); status != http.StatusOK {
		t.Fatalf("switching back = %d", status)
	}
	if got := r.billingOf(t, r.a0Pub); got != "max" {
		t.Fatalf("billing = %v after switching back, want max", got)
	}
}

// AC3: the switch is the Governor's only: any other key is refused (403), the
// mill, the person's own device and a stranger alike, an unsigned request is
// 401, and nothing changed.
func TestOnlyTheGovernorsKeySetsBilling(t *testing.T) {
	r := newBillingRig(t)
	set := map[string]string{"key": r.a0Pub, "billing": "api"}
	for name, signer := range map[string]*btcec.PrivateKey{"the mill": r.mill, "the person's own device": r.a0, "another of their devices": r.a1, "a stranger": r.stranger} {
		if status, body := r.call(http.MethodPut, "/api/register/billing", signer, set); status != http.StatusForbidden {
			t.Fatalf("%s setting billing = %d %v, want 403", name, status, body)
		}
		if status, body := r.call(http.MethodGet, "/api/register/billing", signer, nil); status != http.StatusForbidden {
			t.Fatalf("%s reading the marks = %d %v, want 403", name, status, body)
		}
	}
	if status, _ := r.call(http.MethodPut, "/api/register/billing", nil, set); status != http.StatusUnauthorized {
		t.Fatalf("an unsigned PUT = %d, want 401", status)
	}
	if got := r.billingOf(t, r.a0Pub); got != "max" {
		t.Fatalf("billing = %v after refused attempts, want max", got)
	}
}

// With no POSTERN_ISSUER_KEY there is no Governor to ask: everyone is refused.
func TestNoIssuerKeyMeansNobodySetsBilling(t *testing.T) {
	key, _ := newKey(t)
	svc, err := register.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server, _ := newServerWithOptions(t, WithRegistration(svc, ""))
	raw, _ := json.Marshal(map[string]string{"key": regKey(0), "billing": "api"})
	req, _ := http.NewRequest(http.MethodPut, server.URL+"/api/register/billing", bytes.NewReader(raw))
	signRequest(t, server, key, req)
	if status, _ := regDo(t, req); status != http.StatusForbidden {
		t.Fatalf("PUT with no issuer key configured = %d, want 403", status)
	}
}

func TestBillingRefusesWhatIsNotMaxOrAPIOrAKey(t *testing.T) {
	r := newBillingRig(t)
	for _, bad := range []map[string]string{
		{"key": r.a0Pub, "billing": "free"},
		{"key": r.a0Pub, "billing": ""},
		{"key": "nonsense", "billing": "api"},
	} {
		if status, body := r.call(http.MethodPut, "/api/register/billing", r.governor, bad); status != http.StatusBadRequest {
			t.Fatalf("PUT %v = %d %v, want 400", bad, status, body)
		}
	}
}

// A licence holder who has not registered keeps the mark apart; GET lists the
// api keys so the Key screen can show them; the mill, asking after that key,
// still gets known:false, now with the billing it should use.
func TestBillingOfAKeyNoOneRegisteredIsKeptAndListed(t *testing.T) {
	r := newBillingRig(t)
	if status, body := r.call(http.MethodPut, "/api/register/billing", r.governor, map[string]string{"key": r.strangerPub, "billing": "api"}); status != http.StatusOK {
		t.Fatalf("PUT = %d %v", status, body)
	}
	if status, _ := r.call(http.MethodPut, "/api/register/billing", r.governor, map[string]string{"key": r.a1Pub, "billing": "api"}); status != http.StatusOK {
		t.Fatal("marking a registered device failed")
	}
	status, body := r.call(http.MethodGet, "/api/register/billing", r.governor, nil)
	list, _ := body["api"].([]any)
	if status != http.StatusOK || len(list) != 3 {
		t.Fatalf("GET = %d %v, want 200 and the three api keys", status, body)
	}
	seen := map[string]bool{}
	for _, k := range list {
		seen[k.(string)] = true
	}
	if !seen[r.strangerPub] || !seen[r.a0Pub] || !seen[r.a1Pub] {
		t.Fatalf("api keys = %v", list)
	}
	status, body = r.call(http.MethodGet, "/api/register/person?key="+r.strangerPub, r.mill, nil)
	if status != http.StatusOK || body["known"] != false || body["billing"] != "api" {
		t.Fatalf("the mill asking after the marked stranger = %d %v, want known:false billing:api", status, body)
	}
}
