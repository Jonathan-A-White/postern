package alertsmail

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/alerts"
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

// The receiver's cap fits a notes mail with a PDF at alerts.MaxNotesBytes
// (base64 is 4/3 of it, with line breaks), and refuses a larger mail.
func TestAMailOverMaxMessageBytesIsRefused(t *testing.T) {
	if MaxMessageBytes != 8<<20 {
		t.Fatalf("MaxMessageBytes = %d, want 8 MiB", MaxMessageBytes)
	}
	backend := newFakeBackend(t)
	c := dial(t, listen(t, backend, nil))
	if err := c.Mail("no.reply.alerts@chase.com", nil); err != nil {
		t.Fatal(err)
	}
	if err := c.Rcpt(knownToken+"@"+testDomain, nil); err != nil {
		t.Fatal(err)
	}
	big := append(fixture(t, "chase.eml"), []byte(strings.Repeat(strings.Repeat("x", 76)+"\r\n", MaxMessageBytes/78+10))...)
	if err := send(t, c, big); code(err) != 552 {
		t.Fatalf("DATA over %d bytes = %v, want 552", MaxMessageBytes, err)
	}
	if got := backend.received(); len(got) != 0 {
		t.Fatalf("a refused mail was posted: %+v", got)
	}
}

func TestAMailDeclaredOverMaxMessageBytesIsRefusedAtMail(t *testing.T) {
	backend := newFakeBackend(t)
	c := dial(t, listen(t, backend, nil))
	if err := c.Mail("no.reply.alerts@chase.com", &smtp.MailOptions{Size: MaxMessageBytes + 1}); code(err) != 552 {
		t.Fatalf("MAIL with SIZE over %d bytes = %v, want 552", MaxMessageBytes, err)
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

// captureLog collects what the receiver logs while the test runs.
func captureLog(t *testing.T) func() string {
	t.Helper()
	w := &lockedBuffer{}
	out, flags := log.Writer(), log.Flags()
	log.SetOutput(w)
	log.SetFlags(0)
	t.Cleanup(func() { log.SetOutput(out); log.SetFlags(flags) })
	return w.String
}

type lockedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (l *lockedBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.Write(p)
}

func (l *lockedBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.String()
}

// sendNotes sends one mail from Subsplash to the known token and answers what
// the backend was posted.
func sendNotes(t *testing.T, raw []byte) []map[string]string {
	t.Helper()
	backend := newFakeBackend(t)
	c := dial(t, listen(t, backend, nil))
	if err := c.Mail("noreply@mail.subsplash.com", nil); err != nil {
		t.Fatal(err)
	}
	if err := c.Rcpt(knownToken+"@"+testDomain, nil); err != nil {
		t.Fatalf("RCPT = %v", err)
	}
	if err := send(t, c, raw); err != nil {
		t.Fatalf("DATA = %v", err)
	}
	if err := c.Quit(); err != nil {
		t.Fatal(err)
	}
	return backend.received()
}

// A log line of the receiver holds no token, address, subject or byte of
// the notes.
func assertLogHoldsNothingOfTheMail(t *testing.T, logged string, notes []byte) {
	t.Helper()
	// the one fixed phrase that names the magic every PDF begins with
	logged = strings.ReplaceAll(logged, "does not begin %PDF-", "does not begin (the magic)")
	for _, secret := range []string{knownToken, testDomain, "subsplash.com", "Notes for", "The Day of the Lord", "Grace", "Romans", "INVENTED-NOTES-BODY-MARKER", "%PDF", "JVBER"} {
		if strings.Contains(logged, secret) {
			t.Errorf("the log holds %q: %q", secret, logged)
		}
	}
	if len(notes) > 16 && strings.Contains(logged, string(notes[8:16])) {
		t.Errorf("the log holds bytes of the PDF: %q", logged)
	}
}

// The sermon-notes mail posts the title, reference and date and the attached
// PDF's bytes (base64, as JSON carries bytes), and logs one line with their
// size.
func TestASermonNotesMailIsPostedWithItsNotesAndLogsTheirSize(t *testing.T) {
	logged := captureLog(t)
	got := sendNotes(t, fixture(t, "subsplash-notes.eml"))
	want := map[string]string{"token": knownToken, "kind": "sermon-notes", "title": "The Day of the Lord", "reference": "2 Peter 3:10-18", "when": "2026-11-08T00:00:00-05:00",
		"notes": base64.StdEncoding.EncodeToString([]byte(fixtureNotesPDF))}
	if len(got) != 1 || len(got[0]) != len(want) {
		t.Fatalf("posted %+v, want %+v", got, want)
	}
	for k, v := range want {
		if got[0][k] != v {
			t.Fatalf("posted %s = %q, want %q", k, got[0][k], v)
		}
	}
	line := fmt.Sprintf("alerts-mail: posted a sermon-notes alert with notes (%d bytes)\n", len(fixtureNotesPDF))
	if logged() != line {
		t.Fatalf("logged %q, want %q", logged(), line)
	}
	assertLogHoldsNothingOfTheMail(t, logged(), []byte(fixtureNotesPDF))
}

// A notes PDF at the limit fits in a mail the receiver takes, and reaches the
// backend whole.
func TestASermonNotesMailWithAPDFAtTheLimitIsTaken(t *testing.T) {
	logged := captureLog(t)
	pdf := garbagePDF(alerts.MaxNotesBytes)
	got := sendNotes(t, notesMail(pdfPart("application/pdf", "notes.pdf", pdf)))
	if len(got) != 1 {
		t.Fatalf("posted %d alerts, want 1", len(got))
	}
	decoded, err := base64.StdEncoding.DecodeString(got[0]["notes"])
	if err != nil || !bytes.Equal(decoded, pdf) {
		t.Fatalf("the posted notes are not the PDF (%d bytes, %v)", len(decoded), err)
	}
	if want := fmt.Sprintf("alerts-mail: posted a sermon-notes alert with notes (%d bytes)\n", alerts.MaxNotesBytes); logged() != want {
		t.Fatalf("logged %q, want %q", logged(), want)
	}
}

// A sermon-notes mail with no notes to keep is still posted, title, reference
// and when, with no notes field, and the log says why in one line.
func TestASermonNotesMailWithoutNotesIsPostedAndLogsWhy(t *testing.T) {
	for _, tc := range []struct {
		name string
		raw  []byte
		why  string
	}{
		{"no PDF", notesMail(), "no PDF attached"},
		{"two PDFs", notesMail(pdfPart("application/pdf", "a.pdf", garbagePDF(64)), pdfPart("application/pdf", "b.pdf", garbagePDF(64))), "2 PDFs attached, not one"},
		{"over the limit", notesMail(pdfPart("application/pdf", "notes.pdf", garbagePDF(alerts.MaxNotesBytes+1))), fmt.Sprintf("the PDF is over %d bytes", alerts.MaxNotesBytes)},
		{"not a PDF", notesMail(pdfPart("application/pdf", "notes.pdf", []byte("Grace INVENTED-NOTES-BODY-MARKER"))), "the PDF does not begin %PDF-"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			logged := captureLog(t)
			got := sendNotes(t, tc.raw)
			want := map[string]string{"token": knownToken, "kind": "sermon-notes", "title": "Grace", "reference": "Romans 8:1-4", "when": "2026-11-08T00:00:00-05:00"}
			if len(got) != 1 || len(got[0]) != len(want) {
				t.Fatalf("posted %+v, want %+v", got, want)
			}
			for k, v := range want {
				if got[0][k] != v {
					t.Fatalf("posted %s = %q, want %q", k, got[0][k], v)
				}
			}
			if line := "alerts-mail: posted a sermon-notes alert without notes: " + tc.why + "\n"; logged() != line {
				t.Fatalf("logged %q, want %q", logged(), line)
			}
			assertLogHoldsNothingOfTheMail(t, logged(), nil)
		})
	}
}

// The Gmail confirmation mail's link and the PNC payment's memo reach the
// backend in the post: they were parsed but left out of the body.
func TestAMailsLinkAndMemoAreInTheBodyPosted(t *testing.T) {
	for _, tc := range []struct{ file, field string }{
		{"gmail-confirm.eml", "link"},
		{"gmail-confirm-mail-settings.eml", "link"},
		{"pnc-zelle-sent.eml", "memo"},
	} {
		facts := Parse(fixture(t, tc.file))
		alert := facts.Alert()
		want := map[string]string{"link": alert.Link, "memo": alert.Memo}[tc.field]
		if want == "" {
			t.Fatalf("%s: the parse found no %s, the test has nothing to check", tc.file, tc.field)
		}
		backend := newFakeBackend(t)
		inbound := &HTTPInbound{URL: backend.URL, Secret: testSecret}
		if err := inbound.Post(context.Background(), knownToken, alert); err != nil {
			t.Fatalf("%s: Post = %v", tc.file, err)
		}
		got := backend.received()
		if len(got) != 1 || got[0][tc.field] != want {
			t.Fatalf("%s: posted %+v, want %s %q", tc.file, got, tc.field, want)
		}
	}
}

// Every field of alerts.Alert the receiver can know is in what Post sends, so
// the next field added to Alert cannot be dropped as link and memo were; the
// notes (base64 of a sermon-notes mail's PDF) are one. The id and seq, and the
// notes' sha256 and size, are the backend's to give.
func TestPostSendsEveryFieldOfAnAlert(t *testing.T) {
	var alert alerts.Alert
	v := reflect.ValueOf(&alert).Elem()
	var names []string
	for i := 0; i < v.NumField(); i++ {
		name, _, _ := strings.Cut(v.Type().Field(i).Tag.Get("json"), ",")
		if name == "id" || name == "seq" || name == "notes_sha256" || name == "notes_size" {
			continue
		}
		if v.Field(i).Kind() != reflect.String {
			t.Fatalf("alerts.Alert.%s is not a string: teach this test how Post sends it", v.Type().Field(i).Name)
		}
		v.Field(i).SetString("made-up " + name)
		names = append(names, name)
	}
	backend := newFakeBackend(t)
	inbound := &HTTPInbound{URL: backend.URL, Secret: testSecret}
	if err := inbound.Post(context.Background(), knownToken, alert); err != nil {
		t.Fatalf("Post = %v", err)
	}
	got := backend.received()
	if len(got) != 1 {
		t.Fatalf("posted %+v, want one body", got)
	}
	for _, name := range names {
		if got[0][name] != "made-up "+name {
			t.Errorf("Post left %q out of the body: %+v", name, got[0])
		}
	}
}
