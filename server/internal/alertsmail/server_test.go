package alertsmail

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/emersion/go-smtp"
)

const (
	testDomain = "alerts.example.org"
	testSecret = "the-shared-secret"
	knownToken = "abcdefghijkl"
)

// fakeBackend is the backend's half of §26 the receiver talks to: the token
// check and POST /api/alerts/inbound, both behind the shared secret.
type fakeBackend struct {
	*httptest.Server
	mu     sync.Mutex
	posts  []map[string]string
	checks int
	down   bool
}

func newFakeBackend(t *testing.T) *fakeBackend {
	f := &fakeBackend{}
	mux := http.NewServeMux()
	authorised := func(w http.ResponseWriter, r *http.Request) bool {
		if r.Header.Get("Authorization") != "Bearer "+testSecret {
			w.WriteHeader(http.StatusUnauthorized)
			return false
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.down {
			w.WriteHeader(http.StatusBadGateway)
			return false
		}
		return true
	}
	mux.HandleFunc("GET /api/alerts/inbound/{token}", func(w http.ResponseWriter, r *http.Request) {
		if !authorised(w, r) {
			return
		}
		f.mu.Lock()
		f.checks++
		f.mu.Unlock()
		if r.PathValue("token") != knownToken {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST /api/alerts/inbound", func(w http.ResponseWriter, r *http.Request) {
		if !authorised(w, r) {
			return
		}
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		f.mu.Lock()
		f.posts = append(f.posts, body)
		f.mu.Unlock()
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"0011223344556677","seq":1}`))
	})
	f.Server = httptest.NewServer(mux)
	t.Cleanup(f.Close)
	return f
}

func (f *fakeBackend) received() []map[string]string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]map[string]string(nil), f.posts...)
}

// listen starts the receiver on a loopback port and answers its address.
func listen(t *testing.T, backend *fakeBackend, tlsConfig *tls.Config) string {
	t.Helper()
	srv := NewServer(Config{
		Domain:   testDomain,
		Hostname: "mx.example.org",
		Inbound:  &HTTPInbound{URL: backend.URL, Secret: testSecret},
		TLS:      tlsConfig,
	})
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })
	return ln.Addr().String()
}

func dial(t *testing.T, addr string) *smtp.Client {
	t.Helper()
	c, err := smtp.Dial(addr)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Close() })
	if err := c.Hello("mail.example.net"); err != nil {
		t.Fatal(err)
	}
	return c
}

func code(err error) int {
	var smtpErr *smtp.SMTPError
	if errors.As(err, &smtpErr) {
		return smtpErr.Code
	}
	return 0
}

func send(t *testing.T, c *smtp.Client, body []byte) error {
	t.Helper()
	w, err := c.Data()
	if err != nil {
		t.Fatalf("DATA: %v", err)
	}
	if _, err := w.Write(body); err != nil {
		_ = w.Close()
		return err
	}
	return w.Close()
}

func TestARecipientWithAnUnknownTokenIsRefusedWith550(t *testing.T) {
	backend := newFakeBackend(t)
	c := dial(t, listen(t, backend, nil))
	if err := c.Mail("no.reply.alerts@chase.com", nil); err != nil {
		t.Fatal(err)
	}
	err := c.Rcpt("zzzzzzzzzzzz@"+testDomain, nil)
	if code(err) != 550 {
		t.Fatalf("RCPT to an unknown token = %v, want 550", err)
	}
	if err := c.Rcpt("not-a-token@"+testDomain, nil); code(err) != 550 {
		t.Fatalf("RCPT to a local part that cannot be a token = %v, want 550", err)
	}
	if backend.checks != 1 {
		t.Fatalf("the backend was asked %d times, want once (a local part that is no token is refused unasked)", backend.checks)
	}
}

func TestARelayAttemptIsRefused(t *testing.T) {
	backend := newFakeBackend(t)
	c := dial(t, listen(t, backend, nil))
	if err := c.Mail("someone@example.net", nil); err != nil {
		t.Fatal(err)
	}
	for _, to := range []string{knownToken + "@example.com", knownToken + "@sub." + testDomain, knownToken + "@" + testDomain + ".evil.example"} {
		if err := c.Rcpt(to, nil); code(err) != 550 {
			t.Fatalf("RCPT to %s = %v, want 550", to, err)
		}
	}
	if backend.checks != 0 {
		t.Fatalf("the backend was asked about another domain's mail %d times", backend.checks)
	}
}

func TestAMailOverOneMebibyteIsRefused(t *testing.T) {
	backend := newFakeBackend(t)
	c := dial(t, listen(t, backend, nil))
	if err := c.Mail("no.reply.alerts@chase.com", nil); err != nil {
		t.Fatal(err)
	}
	if err := c.Rcpt(knownToken+"@"+testDomain, nil); err != nil {
		t.Fatal(err)
	}
	big := append(fixture(t, "chase.eml"), []byte(strings.Repeat(strings.Repeat("x", 76)+"\r\n", (1<<20)/78+10))...)
	if err := send(t, c, big); code(err) != 552 {
		t.Fatalf("DATA over 1 MiB = %v, want 552", err)
	}
	if got := backend.received(); len(got) != 0 {
		t.Fatalf("a refused mail was posted: %+v", got)
	}
}

func TestAMailDeclaredOverOneMebibyteIsRefusedAtMail(t *testing.T) {
	backend := newFakeBackend(t)
	c := dial(t, listen(t, backend, nil))
	if err := c.Mail("no.reply.alerts@chase.com", &smtp.MailOptions{Size: 2 << 20}); code(err) != 552 {
		t.Fatalf("MAIL with SIZE over 1 MiB = %v, want 552", err)
	}
}

func TestAnAcceptedMailReachesTheInboundEndpointOnce(t *testing.T) {
	backend := newFakeBackend(t)
	c := dial(t, listen(t, backend, nil))
	if err := c.Mail("no.reply.alerts@chase.com", nil); err != nil {
		t.Fatal(err)
	}
	if err := c.Rcpt(strings.ToUpper(knownToken)+"@"+strings.ToUpper(testDomain), nil); err != nil {
		t.Fatalf("RCPT to a known token = %v", err)
	}
	if err := send(t, c, fixture(t, "chase.eml")); err != nil {
		t.Fatalf("DATA = %v", err)
	}
	if err := c.Quit(); err != nil {
		t.Fatal(err)
	}
	got := backend.received()
	want := map[string]string{"token": knownToken, "kind": "charge", "amount": "9.38", "merchant": "Example Market 0001", "last4": "1234", "when": "2026-11-02T12:42:00-05:00"}
	if len(got) != 1 {
		t.Fatalf("the inbound endpoint got %d posts, want 1: %+v", len(got), got)
	}
	if len(got[0]) != len(want) {
		t.Fatalf("posted %+v, want %+v", got[0], want)
	}
	for k, v := range want {
		if got[0][k] != v {
			t.Fatalf("posted %+v, want %+v", got[0], want)
		}
	}
}

func TestTheSameTokenTwiceInOneMailIsPostedOnce(t *testing.T) {
	backend := newFakeBackend(t)
	c := dial(t, listen(t, backend, nil))
	_ = c.Mail("no.reply.alerts@chase.com", nil)
	for range 2 {
		if err := c.Rcpt(knownToken+"@"+testDomain, nil); err != nil {
			t.Fatal(err)
		}
	}
	if err := send(t, c, fixture(t, "unknown.eml")); err != nil {
		t.Fatal(err)
	}
	if got := backend.received(); len(got) != 1 {
		t.Fatalf("posted %d times, want 1", len(got))
	}
}

func TestABackendThatIsDownDefersTheMailNotRefusesIt(t *testing.T) {
	backend := newFakeBackend(t)
	c := dial(t, listen(t, backend, nil))
	_ = c.Mail("no.reply.alerts@chase.com", nil)
	backend.mu.Lock()
	backend.down = true
	backend.mu.Unlock()
	if err := c.Rcpt(knownToken+"@"+testDomain, nil); code(err) != 451 {
		t.Fatalf("RCPT with the backend down = %v, want 451 (try again later)", err)
	}
}

func TestAPostThatFailsDefersTheMail(t *testing.T) {
	backend := newFakeBackend(t)
	c := dial(t, listen(t, backend, nil))
	_ = c.Mail("no.reply.alerts@chase.com", nil)
	if err := c.Rcpt(knownToken+"@"+testDomain, nil); err != nil {
		t.Fatal(err)
	}
	backend.mu.Lock()
	backend.down = true
	backend.mu.Unlock()
	if err := send(t, c, fixture(t, "chase.eml")); code(err) != 451 {
		t.Fatalf("DATA with the backend down = %v, want 451", err)
	}
}

func TestNoAuthIsOfferedAndStartTLSOnlyWithACert(t *testing.T) {
	backend := newFakeBackend(t)
	plain := dial(t, listen(t, backend, nil))
	if ok, _ := plain.Extension("STARTTLS"); ok {
		t.Fatal("STARTTLS offered with no cert configured")
	}
	if ok, _ := plain.Extension("AUTH"); ok {
		t.Fatal("AUTH offered: the receiver takes no logins")
	}
	addr := listen(t, backend, selfSigned(t))
	if ok, _ := dial(t, addr).Extension("STARTTLS"); !ok {
		t.Fatal("STARTTLS not offered with a cert configured")
	}
	withTLS, err := smtp.DialStartTLS(addr, &tls.Config{InsecureSkipVerify: true})
	if err != nil {
		t.Fatalf("STARTTLS: %v", err)
	}
	defer withTLS.Close()
	if _, ok := withTLS.TLSConnectionState(); !ok {
		t.Fatal("no TLS after STARTTLS")
	}
}

func selfSigned(t *testing.T) *tls.Config {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{SerialNumber: big.NewInt(1), DNSNames: []string{"mx.example.org"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour)}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	return &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}}}
}
