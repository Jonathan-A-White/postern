package standby

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// peerServer is a peer backend: /healthz answers health (a status and a body),
// anything else is recorded and answered 418 "peer <name>".
func peerServer(t *testing.T, name string, healthStatus int, healthBody string) (*httptest.Server, *[]seen) {
	t.Helper()
	var mu sync.Mutex
	var got []seen
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
			w.WriteHeader(healthStatus)
			io.WriteString(w, healthBody)
			return
		}
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		got = append(got, seen{r.Method, r.URL.Path, r.URL.RawQuery, r.Host, r.Header.Clone(), string(b)})
		mu.Unlock()
		w.WriteHeader(http.StatusTeapot)
		io.WriteString(w, "peer "+name)
	}))
	t.Cleanup(srv.Close)
	return srv, &got
}

func deadURL(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	l.Close()
	return "http://" + addr
}

const (
	healthHome    = `{"ok":true,"standby":false,"commit":"x"}`
	healthStandby = `{"ok":true,"standby":true,"home":"a","commit":"x"}`
)

func relayOnly(t *testing.T, order []string, urls map[string]string) (http.Handler, *Finder) {
	t.Helper()
	logged := &logLines{}
	f := NewFinder(urls, order, WithFinderLogf(logged.logf))
	f.Check()
	return RelayOnly(f, WithPeers(urls), WithRelayLogf(logged.logf)), f
}

func TestRelayOnlyRelaysSendsToThePeerThatIsHome(t *testing.T) {
	a, aSeen := peerServer(t, "a", 200, healthHome)
	b, bSeen := peerServer(t, "b", 200, healthStandby)
	h, f := relayOnly(t, []string{"a", "b"}, map[string]string{"a": a.URL, "b": b.URL})

	req := httptest.NewRequest("POST", "/api/messages?x=1", strings.NewReader(`{"m":1}`))
	req.Header.Set("Authorization", "Postern2 k:n:s")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusTeapot || rec.Body.String() != "peer a" {
		t.Fatalf("POST = %d %q, want the home's answer", rec.Code, rec.Body.String())
	}
	rec = do(h, "GET", "/api/challenge")
	if rec.Code != http.StatusTeapot || rec.Body.String() != "peer a" {
		t.Fatalf("GET /api/challenge = %d %q, want the home's answer", rec.Code, rec.Body.String())
	}
	if len(*aSeen) != 2 || len(*bSeen) != 0 {
		t.Fatalf("home saw %d, other peer saw %d, want 2 and 0", len(*aSeen), len(*bSeen))
	}
	s := (*aSeen)[0]
	if s.method != "POST" || s.path != "/api/messages" || s.query != "x=1" || s.body != `{"m":1}` ||
		s.header.Get("Authorization") != "Postern2 k:n:s" || s.header.Get(RelayedHeader) != "1" {
		t.Fatalf("home saw %+v", s)
	}
	if f.Target() != "a" {
		t.Fatalf("Target = %q, want a", f.Target())
	}
}

func TestRelayOnlyFallsBackToTheFirstReachablePeer(t *testing.T) {
	b, bSeen := peerServer(t, "b", 200, healthStandby)
	c, cSeen := peerServer(t, "c", 200, healthStandby)
	h, f := relayOnly(t, []string{"a", "b", "c"}, map[string]string{"a": deadURL(t), "b": b.URL, "c": c.URL})

	rec := do(h, "POST", "/api/messages")
	if rec.Code != http.StatusTeapot || rec.Body.String() != "peer b" {
		t.Fatalf("POST = %d %q, want the first reachable peer's answer", rec.Code, rec.Body.String())
	}
	if len(*bSeen) != 1 || len(*cSeen) != 0 || f.Target() != "b" {
		t.Fatalf("b saw %d, c saw %d, target %q, want 1, 0, b", len(*bSeen), len(*cSeen), f.Target())
	}
}

func TestRelayOnlyAHomeBeatsAnEarlierStandbyPeer(t *testing.T) {
	a, aSeen := peerServer(t, "a", 200, healthStandby)
	b, bSeen := peerServer(t, "b", 200, healthHome)
	h, _ := relayOnly(t, []string{"a", "b"}, map[string]string{"a": a.URL, "b": b.URL})
	if rec := do(h, "POST", "/api/messages"); rec.Body.String() != "peer b" || len(*aSeen) != 0 || len(*bSeen) != 1 {
		t.Fatalf("answer %q, a saw %d, b saw %d, want the home b only", rec.Body.String(), len(*aSeen), len(*bSeen))
	}
}

func TestRelayOnlyAPeerAnsweringNon200IsNotATarget(t *testing.T) {
	a, _ := peerServer(t, "a", 500, healthHome)
	h, f := relayOnly(t, []string{"a"}, map[string]string{"a": a.URL})
	if f.Target() != "" {
		t.Fatalf("Target = %q, want none", f.Target())
	}
	if rec := do(h, "POST", "/api/messages"); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("POST = %d, want 503", rec.Code)
	}
}

func standbyBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("body %q: %v", rec.Body.String(), err)
	}
	return m
}

func TestRelayOnlyAnswers503StandbyWhenNoPeerAnswers(t *testing.T) {
	h, _ := relayOnly(t, []string{"a", "b"}, map[string]string{"a": deadURL(t), "b": deadURL(t)})
	for _, tc := range [][2]string{{"POST", "/api/messages"}, {"GET", "/api/challenge"}, {"GET", "/api/me"}, {"POST", "/api/broadcast"}, {"GET", "/api/utxos/addr"}} {
		rec := do(h, tc[0], tc[1])
		if rec.Code != http.StatusServiceUnavailable || standbyBody(t, rec)["standby"] != true {
			t.Errorf("%s %s = %d %q, want 503 with standby true", tc[0], tc[1], rec.Code, rec.Body.String())
		}
	}
}

func TestRelayOnlyDoesNotServeANonSendRoute(t *testing.T) {
	a, aSeen := peerServer(t, "a", 200, healthHome)
	h, _ := relayOnly(t, []string{"a"}, map[string]string{"a": a.URL})
	rec := do(h, "GET", "/api/messages")
	if rec.Code != http.StatusServiceUnavailable || standbyBody(t, rec)["standby"] != true {
		t.Fatalf("GET /api/messages = %d %q, want 503 with standby true", rec.Code, rec.Body.String())
	}
	if len(*aSeen) != 0 {
		t.Fatal("a non-send route reached the peer")
	}
}

func TestRelayOnlyNeverRelaysARelayedRequestAgain(t *testing.T) {
	a, aSeen := peerServer(t, "a", 200, healthHome)
	h, _ := relayOnly(t, []string{"a"}, map[string]string{"a": a.URL})
	req := httptest.NewRequest("POST", "/api/messages", strings.NewReader("{}"))
	req.Header.Set(RelayedHeader, "1")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable || standbyBody(t, rec)["standby"] != true {
		t.Fatalf("POST = %d %q, want 503 standby", rec.Code, rec.Body.String())
	}
	if len(*aSeen) != 0 {
		t.Fatal("a relayed request was relayed again")
	}
}

func TestRelayOnlyAnswers502OnceThePeerHasTheConnection(t *testing.T) {
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
				c.Read(make([]byte, 4096))
				c.Close()
			}()
		}
	}()
	urls := map[string]string{"a": "http://" + l.Addr().String()}
	f := NewFinder(urls, []string{"a"}, WithFinderLogf(func(string, ...any) {}))
	f.mu.Lock()
	f.target, f.home = "a", "a" // the health probe above is not answered; fix the target by hand
	f.mu.Unlock()
	h := RelayOnly(f, WithPeers(urls), WithRelayLogf(func(string, ...any) {}))
	if rec := do(h, "POST", "/api/messages"); rec.Code != http.StatusBadGateway {
		t.Fatalf("POST = %d, want 502", rec.Code)
	}
}

func TestRelayOnlyHealthzShowsTheTarget(t *testing.T) {
	a, _ := peerServer(t, "a", 200, healthHome)
	h, f := relayOnly(t, []string{"a"}, map[string]string{"a": a.URL})
	rec := do(h, "GET", "/healthz")
	m := standbyBody(t, rec)
	if rec.Code != http.StatusOK || m["ok"] != true || m["standby"] != true || m["relay_only"] != true || m["target"] != "a" {
		t.Fatalf("healthz = %d %q, want 200 ok, standby, relay_only, target a", rec.Code, rec.Body.String())
	}
	if _, ok := m["commit"]; !ok {
		t.Fatalf("healthz %q has no commit", rec.Body.String())
	}

	a.Close()
	f.Check()
	rec = do(h, "GET", "/healthz")
	m = standbyBody(t, rec)
	if v, ok := m["target"]; !ok || v != "" || m["relay_only"] != true {
		t.Fatalf("healthz after the peer died = %q, want an empty target", rec.Body.String())
	}
}

func TestFinderLogsEachChangeOfTargetOnce(t *testing.T) {
	a, _ := peerServer(t, "a", 200, healthHome)
	logged := &logLines{}
	f := NewFinder(map[string]string{"a": a.URL}, []string{"a"}, WithFinderLogf(logged.logf))
	f.Check()
	f.Check()
	if n := logged.count("target"); n != 1 {
		t.Fatalf("target lines after two identical checks = %d, want 1: %v", n, logged.lines)
	}
	a.Close()
	f.Check()
	if n := logged.count("target"); n != 2 {
		t.Fatalf("target lines after the peer died = %d, want 2: %v", n, logged.lines)
	}
}
