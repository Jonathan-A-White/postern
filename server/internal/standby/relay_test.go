package standby

import (
	"bytes"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/auth"
)

// logLines collects what a monitor or relay logs.
type logLines struct {
	mu    sync.Mutex
	lines []string
}

func (l *logLines) logf(format string, args ...any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.lines = append(l.lines, fmt.Sprintf(format, args...))
}

func (l *logLines) count(substr string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	n := 0
	for _, line := range l.lines {
		if strings.Contains(line, substr) {
			n++
		}
	}
	return n
}

func standbyMonitor(home string) *Monitor {
	m := New("x", WithRunner(stubRunner(home+"\n", errExit1)))
	m.Check()
	return m
}

// localServer is the standby's own backend: it counts what it served.
func localServer(served *int) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*served++
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("served locally"))
	})
}

// seen is one request as the home's server saw it.
type seen struct {
	method, path, query, host string
	header                    http.Header
	body                      string
}

func homeServer(t *testing.T, status int, reply string) (*httptest.Server, *[]seen) {
	t.Helper()
	var mu sync.Mutex
	var got []seen
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		got = append(got, seen{r.Method, r.URL.Path, r.URL.RawQuery, r.Host, r.Header.Clone(), string(b)})
		mu.Unlock()
		w.Header().Set("X-Home", "yes")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		io.WriteString(w, reply)
	}))
	t.Cleanup(srv.Close)
	return srv, &got
}

func TestStandbyRelaysAPostToTheHomeUnchanged(t *testing.T) {
	home, got := homeServer(t, http.StatusCreated, `{"txid":"abc"}`)
	served := 0
	h := Middleware(standbyMonitor("laptop"), localServer(&served), WithPeers(map[string]string{"laptop": home.URL}))

	payload := `{"to":"02aa","payload":"bb"}`
	req := httptest.NewRequest("POST", "/api/messages?x=1&y=2", strings.NewReader(payload))
	req.Host = "postern.allmymind.org"
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Postern key=02aa sig=zz")
	req.Header.Set("X-Custom", "one")
	req.Header.Add("X-Custom", "two")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if served != 0 {
		t.Fatalf("the standby served the send itself %d times", served)
	}
	if len(*got) != 1 {
		t.Fatalf("the home saw %d requests, want 1", len(*got))
	}
	s := (*got)[0]
	if s.method != "POST" || s.path != "/api/messages" || s.query != "x=1&y=2" || s.body != payload || s.host != "postern.allmymind.org" {
		t.Fatalf("home saw %+v", s)
	}
	for name, want := range map[string][]string{
		"Content-Type":  {"application/json"},
		"Authorization": {"Postern key=02aa sig=zz"},
		"X-Custom":      {"one", "two"},
	} {
		if got := s.header.Values(name); strings.Join(got, "|") != strings.Join(want, "|") {
			t.Errorf("header %s at the home = %v, want %v", name, got, want)
		}
	}
	if rec.Code != http.StatusCreated || rec.Body.String() != `{"txid":"abc"}` || rec.Header().Get("X-Home") != "yes" || rec.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("answer = %d %q %v, want the home's 201, body and headers", rec.Code, rec.Body.String(), rec.Header())
	}
}

func TestStandbyRelaysAGetChallengeAndPassesOnTheHomesError(t *testing.T) {
	home, got := homeServer(t, http.StatusUnauthorized, `{"error":"nope"}`)
	served := 0
	h := Middleware(standbyMonitor("laptop"), localServer(&served), WithPeers(map[string]string{"laptop": home.URL}))

	rec := do(h, "GET", "/api/challenge")
	if served != 0 || len(*got) != 1 || (*got)[0].method != "GET" || (*got)[0].path != "/api/challenge" {
		t.Fatalf("served=%d home saw %+v", served, *got)
	}
	if rec.Code != http.StatusUnauthorized || rec.Body.String() != `{"error":"nope"}` {
		t.Fatalf("answer = %d %q, want the home's 401 unchanged (no fallback on a status)", rec.Code, rec.Body.String())
	}
}

func TestStandbyRelaysEverySendRouteAndNothingElse(t *testing.T) {
	home, got := homeServer(t, http.StatusOK, "home")
	served := 0
	h := Middleware(standbyMonitor("laptop"), localServer(&served), WithPeers(map[string]string{"laptop": home.URL}))
	for _, c := range [][2]string{
		{"GET", "/api/challenge"}, {"POST", "/api/messages"}, {"GET", "/api/me"},
		{"GET", "/api/utxos/mabc"}, {"POST", "/api/broadcast"},
	} {
		if rec := do(h, c[0], c[1]); rec.Body.String() != "home" {
			t.Errorf("%s %s = %q, want the home's answer", c[0], c[1], rec.Body.String())
		}
	}
	if len(*got) != 5 || served != 0 {
		t.Fatalf("home saw %d, served locally %d, want 5 and 0", len(*got), served)
	}
	// Not relayed: the 503s and /healthz stay as they were.
	if rec := do(h, "GET", "/api/messages"); rec.Code != http.StatusServiceUnavailable {
		t.Errorf("GET /api/messages = %d, want 503", rec.Code)
	}
	if rec := do(h, "GET", "/healthz"); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"standby":true`) {
		t.Errorf("GET /healthz = %d %q", rec.Code, rec.Body.String())
	}
	if len(*got) != 5 {
		t.Fatalf("home saw %d requests, want still 5", len(*got))
	}
}

// closedURL is the URL of a port nothing listens on.
func closedURL(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	l.Close()
	return "http://" + addr
}

func TestStandbyServesLocallyWhenTheHomeCannotBeReached(t *testing.T) {
	served := 0
	logs := &logLines{}
	payload := "the body"
	req := httptest.NewRequest("POST", "/api/messages", strings.NewReader(payload))
	rec := httptest.NewRecorder()
	var sawBody string
	h := Middleware(standbyMonitor("laptop"), http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		sawBody = string(b)
		served++
		w.Write([]byte("served locally"))
	}), WithPeers(map[string]string{"laptop": closedURL(t)}), WithRelayLogf(logs.logf))
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK || rec.Body.String() != "served locally" || served != 1 {
		t.Fatalf("answer = %d %q, served %d, want the standby's own (the dead-home case)", rec.Code, rec.Body.String(), served)
	}
	if sawBody != payload {
		t.Fatalf("the local handler read body %q, want %q (the relay must not eat it)", sawBody, payload)
	}
	if logs.count("relay") == 0 {
		t.Fatalf("no relay failure was logged: %v", logs.lines)
	}
}

func TestStandbyAnswers502WhenTheHomeFailsMidRequest(t *testing.T) {
	// The home accepts the connection, reads the request, then hangs up.
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			go func() {
				buf := make([]byte, 4096)
				c.Read(buf)
				c.Close()
			}()
		}
	}()
	served := 0
	logs := &logLines{}
	h := Middleware(standbyMonitor("laptop"), localServer(&served),
		WithPeers(map[string]string{"laptop": "http://" + l.Addr().String()}), WithRelayLogf(logs.logf))

	for _, c := range [][2]string{{"POST", "/api/messages"}, {"GET", "/api/challenge"}} {
		rec := do(h, c[0], c[1])
		if rec.Code != http.StatusBadGateway {
			t.Errorf("%s %s = %d, want 502", c[0], c[1], rec.Code)
		}
	}
	if served != 0 {
		t.Fatalf("the standby served %d requests itself after the home had them", served)
	}
	if logs.count("relay") != 2 {
		t.Fatalf("relay failures logged = %d, want 2: %v", logs.count("relay"), logs.lines)
	}
}

func TestStandbyWithNoPeersServesAsBeforeAndLogsOnceAtStart(t *testing.T) {
	served := 0
	logs := &logLines{}
	h := Middleware(standbyMonitor("laptop"), localServer(&served), WithRelayLogf(logs.logf))
	if logs.count("POSTERN_PEERS") != 1 {
		t.Fatalf("start log lines naming POSTERN_PEERS = %d, want 1: %v", logs.count("POSTERN_PEERS"), logs.lines)
	}
	for i := 0; i < 3; i++ {
		if rec := do(h, "POST", "/api/messages"); rec.Body.String() != "served locally" {
			t.Fatalf("answer = %q", rec.Body.String())
		}
	}
	if served != 3 || logs.count("POSTERN_PEERS") != 1 {
		t.Fatalf("served %d, log lines %d, want 3 and still 1", served, logs.count("POSTERN_PEERS"))
	}
}

func TestStandbyWithNoURLForTheHomeServesLocallyAndLogsOnce(t *testing.T) {
	other, got := homeServer(t, http.StatusOK, "other")
	served := 0
	logs := &logLines{}
	h := Middleware(standbyMonitor("desktop"), localServer(&served),
		WithPeers(map[string]string{"laptop": other.URL}), WithRelayLogf(logs.logf))
	for i := 0; i < 3; i++ {
		if rec := do(h, "GET", "/api/challenge"); rec.Body.String() != "served locally" {
			t.Fatalf("answer = %q", rec.Body.String())
		}
	}
	if served != 3 || len(*got) != 0 {
		t.Fatalf("served %d, the named peer saw %d, want 3 and 0", served, len(*got))
	}
	if logs.count("desktop") != 1 {
		t.Fatalf("log lines naming the home = %d, want 1: %v", logs.count("desktop"), logs.lines)
	}
}

func TestPeerLookupIgnoresCaseOfTheHomesName(t *testing.T) {
	home, got := homeServer(t, http.StatusOK, "home")
	served := 0
	h := Middleware(standbyMonitor("Laptop"), localServer(&served), WithPeers(map[string]string{"laptop": home.URL}))
	do(h, "GET", "/api/challenge")
	if len(*got) != 1 || served != 0 {
		t.Fatalf("home saw %d, served %d", len(*got), served)
	}
}

func TestAtHomeIgnoresPeers(t *testing.T) {
	peer, got := homeServer(t, http.StatusOK, "peer")
	served := 0
	atHome := New("x", WithRunner(stubRunner("laptop", nil)))
	atHome.Check()
	h := Middleware(atHome, localServer(&served), WithPeers(map[string]string{"laptop": peer.URL}))
	if rec := do(h, "POST", "/api/messages"); rec.Body.String() != "served locally" {
		t.Fatalf("answer = %q, want served locally", rec.Body.String())
	}
	if served != 1 || len(*got) != 0 {
		t.Fatalf("served %d, peer saw %d", served, len(*got))
	}
}

func TestAStandbyThatIsToldTheRequestWasRelayedServesItItself(t *testing.T) {
	// Two hosts that each think the other is home must not pass a send back
	// and forth: a relayed request is served where it lands.
	peer, got := homeServer(t, http.StatusOK, "peer")
	served := 0
	h := Middleware(standbyMonitor("laptop"), localServer(&served), WithPeers(map[string]string{"laptop": peer.URL}))
	req := httptest.NewRequest("POST", "/api/messages", bytes.NewReader([]byte("x")))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	relayed := (*got)[0].header.Get(RelayedHeader)
	if relayed == "" {
		t.Fatal("a relayed request carries no marker")
	}
	req = httptest.NewRequest("POST", "/api/messages", bytes.NewReader([]byte("x")))
	req.Header.Set(RelayedHeader, relayed)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if served != 1 || len(*got) != 1 {
		t.Fatalf("served %d, peer saw %d, want 1 and still 1", served, len(*got))
	}
}

// A challenge the standby relays to the home is bound to the home: the nonce
// the phone spends there is no good on the standby's own backend, so a header
// captured in flight cannot be spent a second time where the home is out of
// reach (mw-xhtcup.6).
func TestANonceSpentThroughTheRelayOnTheHomeCannotBeSpentOnTheStandby(t *testing.T) {
	key := make([]byte, 32)
	homeNonces := auth.NewNonceStore(time.Minute, auth.WithKey(key), auth.WithHostname("laptop"))
	standbyNonces := auth.NewNonceStore(time.Minute, auth.WithKey(key), auth.WithHostname("desktop"))

	// A backend that issues on /api/challenge and spends whatever POST /api/messages names.
	backend := func(name string, n *auth.NonceStore) http.Handler {
		mux := http.NewServeMux()
		mux.HandleFunc("/api/challenge", func(w http.ResponseWriter, r *http.Request) {
			nonce, _ := n.Issue()
			fmt.Fprint(w, nonce)
		})
		mux.HandleFunc("/api/messages", func(w http.ResponseWriter, r *http.Request) {
			if n.Consume(r.URL.Query().Get("nonce")) {
				fmt.Fprint(w, name+" accepted")
				return
			}
			http.Error(w, name+" refused", http.StatusUnauthorized)
		})
		return mux
	}
	home := httptest.NewServer(backend("home", homeNonces))
	t.Cleanup(home.Close)
	h := Middleware(standbyMonitor("laptop"), backend("standby", standbyNonces),
		WithPeers(map[string]string{"laptop": home.URL}))

	nonce := do(h, "GET", "/api/challenge").Body.String() // relayed: issued by the home
	if len(nonce) != 128 {
		t.Fatalf("relayed challenge = %q, want a 128-hex nonce from the home", nonce)
	}
	if rec := do(h, "POST", "/api/messages?nonce="+nonce); rec.Body.String() != "home accepted" {
		t.Fatalf("the home on its own nonce: %q", rec.Body.String())
	}
	// Spent on the home; the standby, serving locally, must refuse the same header.
	if standbyNonces.Consume(nonce) {
		t.Fatal("the standby accepted a nonce the home issued and spent")
	}
	// And one the home issued but never spent is no good on the standby either.
	unspent, _ := homeNonces.Issue()
	if standbyNonces.Consume(unspent) {
		t.Fatal("the standby accepted a nonce the home issued")
	}
}
