package standby

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/buildinfo"
	"github.com/Jonathan-A-White/postern/server/internal/index"
	"github.com/Jonathan-A-White/postern/server/internal/notify"
)

var errExit1 = errors.New("exit status 1")

// stubRunner answers a monitor's home check with a fixed exit and output.
func stubRunner(out string, err error) Runner {
	return func(ctx context.Context) ([]byte, error) { return []byte(out), err }
}

func TestNilMonitorIsNeverStandby(t *testing.T) {
	var m *Monitor
	m.Check()
	if m.Standby() {
		t.Fatal("a nil monitor (POSTERN_HOME_CMD unset) must not be standby")
	}
	if m.Home() != "" {
		t.Fatalf("Home = %q, want empty", m.Home())
	}
}

func TestCheckExitZeroIsHome(t *testing.T) {
	m := New("mw home --check", WithRunner(stubRunner("laptop\n", nil)))
	m.Check()
	if m.Standby() {
		t.Fatal("exit 0 means this host is home")
	}
}

func TestCheckNonZeroIsStandbyAndKeepsWhatItPrinted(t *testing.T) {
	m := New("mw home --check", WithRunner(stubRunner("  desktop \n", errExit1)))
	m.Check()
	if !m.Standby() {
		t.Fatal("a failing command means standby")
	}
	if m.Home() != "desktop" {
		t.Fatalf("Home = %q, want %q", m.Home(), "desktop")
	}
}

func TestCheckFlipsBothWays(t *testing.T) {
	var fail error = errExit1
	m := New("x", WithRunner(func(ctx context.Context) ([]byte, error) { return nil, fail }))
	m.Check()
	if !m.Standby() {
		t.Fatal("want standby")
	}
	fail = nil
	m.Check()
	if m.Standby() {
		t.Fatal("want home after the command succeeds")
	}
}

func TestShellRunnerUsesExitStatus(t *testing.T) {
	yes := New("echo here; exit 0")
	yes.Check()
	if yes.Standby() {
		t.Fatal("exit 0 must be home")
	}
	no := New("echo elsewhere; exit 1")
	no.Check()
	if !no.Standby() || no.Home() != "elsewhere" {
		t.Fatalf("standby=%v home=%q", no.Standby(), no.Home())
	}
}

func TestRunRechecksEveryInterval(t *testing.T) {
	calls := make(chan struct{}, 10)
	m := New("x", WithRunner(func(ctx context.Context) ([]byte, error) {
		calls <- struct{}{}
		return nil, nil
	}))
	stop := make(chan struct{})
	defer close(stop)
	go m.Run(stop, 5*time.Millisecond)
	for i := 0; i < 3; i++ {
		select {
		case <-calls:
		case <-time.After(2 * time.Second):
			t.Fatalf("only %d checks ran", i)
		}
	}
}

type recorded struct{ count int }

func (r *recorded) RecordIndexed(index.Record) { r.count++ }

func TestGateSilencesNotifierInStandbyOnly(t *testing.T) {
	inner := &recorded{}
	m := New("x", WithRunner(stubRunner("", errExit1)))
	m.Check()
	gated := Gate(m, inner)
	gated.RecordIndexed(index.Record{TxID: "a"})
	if inner.count != 0 {
		t.Fatal("standby must not notify")
	}

	home := New("x", WithRunner(stubRunner("", nil)))
	home.Check()
	Gate(home, inner).RecordIndexed(index.Record{TxID: "b"})
	Gate(nil, inner).RecordIndexed(index.Record{TxID: "c"})
	if inner.count != 2 {
		t.Fatalf("count = %d, want 2", inner.count)
	}
}

func TestGateWithinFanoutLeavesOthersRunning(t *testing.T) {
	push, hook := &recorded{}, &recorded{}
	m := New("x", WithRunner(stubRunner("", errExit1)))
	m.Check()
	notify.Fanout{Gate(m, push), hook}.RecordIndexed(index.Record{TxID: "a"})
	if push.count != 0 || hook.count != 1 {
		t.Fatalf("push=%d hook=%d, want 0 and 1", push.count, hook.count)
	}
}

func serve(m *Monitor, worked *int) http.Handler {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*worked++
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})
	return Middleware(m, next)
}

func do(h http.Handler, method, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec
}

func TestMiddlewareStandbyAnswers503BeforeAnyWork(t *testing.T) {
	m := New("x", WithRunner(stubRunner("desktop\n", errExit1)))
	m.Check()
	worked := 0
	h := serve(m, &worked)

	for _, c := range [][2]string{
		{"GET", "/api/view"}, {"GET", "/api/messages"}, {"GET", "/api/events"},
		{"GET", "/api/beads/mw-1"}, {"GET", "/api/me/extra"}, {"POST", "/api/blobs"},
		{"POST", "/api/push/subscribe"}, {"GET", "/api/balance/x"}, {"GET", "/api/nothing"},
		{"GET", "/api/challenge/x"},
	} {
		rec := do(h, c[0], c[1])
		if rec.Code != http.StatusServiceUnavailable {
			t.Errorf("%s %s = %d, want 503", c[0], c[1], rec.Code)
			continue
		}
		var body map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("%s %s body %q: %v", c[0], c[1], rec.Body.String(), err)
		}
		if body["standby"] != true || body["home"] != "desktop" {
			t.Errorf("%s %s body = %v", c[0], c[1], body)
		}
	}
	if worked != 0 {
		t.Fatalf("handler ran %d times in standby", worked)
	}
}

func TestMiddlewareStandbyOmitsHomeWhenNothingPrinted(t *testing.T) {
	m := New("x", WithRunner(stubRunner("", errExit1)))
	m.Check()
	worked := 0
	rec := do(serve(m, &worked), "GET", "/api/view")
	var body map[string]any
	json.Unmarshal(rec.Body.Bytes(), &body)
	if _, has := body["home"]; has || body["standby"] != true {
		t.Fatalf("body = %v", body)
	}
}

func TestMiddlewareStandbyLetsSendRoutesThrough(t *testing.T) {
	m := New("x", WithRunner(stubRunner("", errExit1)))
	m.Check()
	worked := 0
	h := serve(m, &worked)
	sends := [][2]string{
		{"GET", "/api/challenge"}, {"POST", "/api/messages"}, {"GET", "/api/me"},
		{"GET", "/api/utxos/mabc"}, {"POST", "/api/broadcast"},
	}
	for _, c := range sends {
		if rec := do(h, c[0], c[1]); rec.Code != http.StatusOK {
			t.Errorf("%s %s = %d, want passed through", c[0], c[1], rec.Code)
		}
	}
	if worked != len(sends) {
		t.Fatalf("handler ran %d times, want %d", worked, len(sends))
	}
	// GET /api/messages is the read side, not a send.
	if rec := do(h, "GET", "/api/messages"); rec.Code != http.StatusServiceUnavailable {
		t.Errorf("GET /api/messages = %d, want 503", rec.Code)
	}
}

func TestMiddlewareStandbyHealthzIsOKWithStandbyTrue(t *testing.T) {
	m := New("x", WithRunner(stubRunner("desktop", errExit1)))
	m.Check()
	worked := 0
	rec := do(serve(m, &worked), "GET", "/healthz")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	body, _ := io.ReadAll(rec.Body)
	var got map[string]any
	if err := json.Unmarshal(body, &got); err != nil || got["standby"] != true {
		t.Fatalf("body = %q (%v)", body, err)
	}
	if got["commit"] != buildinfo.Commit() {
		t.Fatalf("commit = %v, want %q", got["commit"], buildinfo.Commit())
	}
}

func TestMiddlewareHomeAndUnsetPassEverythingThrough(t *testing.T) {
	home := New("x", WithRunner(stubRunner("", nil)))
	home.Check()
	for name, m := range map[string]*Monitor{"home": home, "unset": nil} {
		worked := 0
		h := serve(m, &worked)
		for _, p := range []string{"/api/view", "/api/messages", "/healthz"} {
			rec := do(h, "GET", p)
			if rec.Code != http.StatusOK || rec.Body.String() != "ok" {
				t.Errorf("%s: GET %s = %d %q", name, p, rec.Code, rec.Body.String())
			}
		}
		if worked != 3 {
			t.Errorf("%s: handler ran %d times, want 3", name, worked)
		}
	}
}

func TestMiddlewareFollowsTheMonitorAsItFlips(t *testing.T) {
	var fail error = errExit1
	m := New("x", WithRunner(func(ctx context.Context) ([]byte, error) { return nil, fail }))
	m.Check()
	worked := 0
	h := serve(m, &worked)
	if do(h, "GET", "/api/view").Code != http.StatusServiceUnavailable {
		t.Fatal("want 503 in standby")
	}
	fail = nil
	m.Check()
	if do(h, "GET", "/api/view").Code != http.StatusOK {
		t.Fatal("want 200 once home")
	}
}
