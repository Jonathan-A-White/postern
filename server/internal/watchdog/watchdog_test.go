package watchdog

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

// target is the watched backend: a real HTTP server that can be taken down.
type target struct {
	server *httptest.Server
	down   atomic.Bool
}

func newTarget(t *testing.T) *target {
	t.Helper()
	tg := &target{}
	tg.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if tg.down.Load() {
			w.WriteHeader(http.StatusBadGateway) // what nginx says with the desktop gone
			return
		}
		w.Write([]byte("ok"))
	}))
	t.Cleanup(tg.server.Close)
	return tg
}

type sent struct {
	class, title, body string
	ts                 int64
}

// fakeSender records every alarm pushed; fail makes it deliver nothing.
type fakeSender struct {
	sent []sent
	fail bool
}

func (f *fakeSender) notify(a Alarm) (int, error) {
	if f.fail {
		return 0, errors.New("push service unreachable")
	}
	f.sent = append(f.sent, sent{class: a.Class, title: a.Title, body: a.Body, ts: a.Ts})
	return 1, nil
}

type harness struct {
	t      *testing.T
	cfg    Config
	now    time.Time
	target *target
	sender *fakeSender
}

func newHarness(t *testing.T) *harness {
	tg := newTarget(t)
	return &harness{
		t:      t,
		cfg:    Config{URL: tg.server.URL + "/healthz", After: 3 * time.Minute, Name: "desktop", DataDir: t.TempDir()},
		now:    time.Date(2026, 9, 28, 12, 3, 20, 0, time.UTC),
		target: tg,
		sender: &fakeSender{},
	}
}

// tick runs the watchdog once at the harness's clock, then advances it.
func (h *harness) tick(advance time.Duration) {
	h.t.Helper()
	err := Run(h.cfg, Deps{
		Now:    func() time.Time { return h.now },
		Check:  HTTPCheck(time.Second),
		Notify: h.sender.notify,
		Logf:   h.t.Logf,
	})
	if err != nil {
		h.t.Fatalf("Run: %v", err)
	}
	h.now = h.now.Add(advance)
}

func (h *harness) wantSent(n int) {
	h.t.Helper()
	if len(h.sender.sent) != n {
		h.t.Fatalf("sent %d alarms (%+v), want %d", len(h.sender.sent), h.sender.sent, n)
	}
}

func TestUpNeverAlarms(t *testing.T) {
	h := newHarness(t)
	for i := 0; i < 5; i++ {
		h.tick(time.Minute)
	}
	h.wantSent(0)
}

func TestDownLongerThanAfterAlarmsOnceThenBackAlarmsOnce(t *testing.T) {
	h := newHarness(t)
	h.tick(time.Minute) // 12:03:20 up

	h.target.down.Store(true)
	h.tick(time.Minute) // 12:04:20 first seen down
	h.tick(time.Minute) // 12:05:20
	h.tick(time.Minute) // 12:06:20
	h.wantSent(0)

	h.tick(time.Minute) // 12:07:20, down 3 minutes
	h.wantSent(1)
	got := h.sender.sent[0]
	if got.class != "alarm" || got.title != "desktop unreachable" || got.body != "since 12:04Z" {
		t.Fatalf("alarm = %+v, want class alarm, \"desktop unreachable\", \"since 12:04Z\"", got)
	}
	if got.ts != time.Date(2026, 9, 28, 12, 7, 20, 0, time.UTC).Unix() {
		t.Fatalf("ts = %d, want the time of the check that alarmed", got.ts)
	}

	h.tick(time.Minute) // 12:08:20, still down
	h.tick(5 * time.Minute)
	h.wantSent(1)

	h.target.down.Store(false)
	h.tick(time.Minute) // 12:14:20, up after 10 minutes down
	h.wantSent(2)
	if back := h.sender.sent[1]; back.class != "alarm" || back.title != "desktop is back" || back.body != "down 10 min" {
		t.Fatalf("alarm = %+v, want class alarm, \"desktop is back\", \"down 10 min\"", back)
	}

	h.tick(time.Minute)
	h.tick(time.Minute)
	h.wantSent(2)
}

func TestABlipShorterThanAfterIsForgotten(t *testing.T) {
	h := newHarness(t)
	h.target.down.Store(true)
	h.tick(2 * time.Minute)
	h.target.down.Store(false)
	h.tick(time.Minute)
	h.target.down.Store(true)
	h.tick(2 * time.Minute) // down again: the clock starts over
	h.tick(time.Minute)
	h.wantSent(0)
}

func TestAnUnreachableTargetCountsAsDown(t *testing.T) {
	h := newHarness(t)
	h.target.server.Close()
	h.tick(3 * time.Minute)
	h.tick(time.Minute)
	h.wantSent(1)
}

func TestAHangingTargetCountsAsDown(t *testing.T) {
	release := make(chan struct{})
	hanging := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-release
	}))
	defer hanging.Close()
	defer close(release)

	if err := HTTPCheck(50 * time.Millisecond)(hanging.URL); err == nil {
		t.Fatal("HTTPCheck = nil for a target that never answers, want a timeout")
	}
}

func TestAFailedAlarmIsRetriedOnTheNextRun(t *testing.T) {
	h := newHarness(t)
	h.target.down.Store(true)
	h.tick(3 * time.Minute)
	h.sender.fail = true
	h.tick(time.Minute) // due, but the push fails
	h.sender.fail = false
	h.wantSent(0)

	h.tick(time.Minute)
	h.wantSent(1)
	if got := h.sender.sent[0]; got.body != "since 12:03Z" {
		t.Fatalf("alarm = %+v, want it still naming the first failed check", got)
	}
}

func TestTheNameIsConfigurable(t *testing.T) {
	h := newHarness(t)
	h.cfg.Name = "laptop"
	h.target.down.Store(true)
	h.tick(3 * time.Minute)
	h.tick(time.Minute)
	h.wantSent(1)
	if got := h.sender.sent[0].title; got != "laptop unreachable" {
		t.Fatalf("title = %q, want \"laptop unreachable\"", got)
	}
}

func TestStateLivesInTheDataDirectory(t *testing.T) {
	h := newHarness(t)
	h.target.down.Store(true)
	h.tick(time.Minute)
	if _, err := os.Stat(filepath.Join(h.cfg.DataDir, "watchdog-state.json")); err != nil {
		t.Fatalf("state file: %v", err)
	}
}

func TestLoadConfig(t *testing.T) {
	env := map[string]string{"POSTERN_WATCH_URL": "http://desktop.mw:8787/healthz"}
	cfg, err := LoadConfig(func(key string) string { return env[key] })
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	want := Config{URL: "http://desktop.mw:8787/healthz", After: 3 * time.Minute, Name: "desktop", DataDir: "./data", Subscriber: "https://postern.allmymind.org"}
	if cfg != want {
		t.Fatalf("cfg = %+v, want %+v", cfg, want)
	}

	env = map[string]string{
		"POSTERN_WATCH_URL":       "http://10.88.0.3:8787/healthz",
		"POSTERN_WATCH_AFTER":     "90s",
		"POSTERN_WATCH_NAME":      "laptop",
		"POSTERN_DATA":            "/var/lib/postern-watchdog",
		"POSTERN_PUSH_SUBSCRIBER": "mailto:governor@example.com",
	}
	cfg, err = LoadConfig(func(key string) string { return env[key] })
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	want = Config{URL: "http://10.88.0.3:8787/healthz", After: 90 * time.Second, Name: "laptop", DataDir: "/var/lib/postern-watchdog", Subscriber: "mailto:governor@example.com"}
	if cfg != want {
		t.Fatalf("cfg = %+v, want %+v", cfg, want)
	}

	for name, env := range map[string]map[string]string{
		"no url":       {},
		"bad after":    {"POSTERN_WATCH_URL": "http://x/healthz", "POSTERN_WATCH_AFTER": "three minutes"},
		"after <= 0":   {"POSTERN_WATCH_URL": "http://x/healthz", "POSTERN_WATCH_AFTER": "0s"},
		"url not http": {"POSTERN_WATCH_URL": "desktop.mw:8787"},
	} {
		if _, err := LoadConfig(func(key string) string { return env[key] }); err == nil {
			t.Fatalf("%s: LoadConfig = nil error, want a config fault", name)
		}
	}
}

func TestAFailedBackAlarmIsRetriedOnTheNextRun(t *testing.T) {
	h := newHarness(t)
	h.target.down.Store(true)
	h.tick(3 * time.Minute)
	h.tick(time.Minute) // alarmed: unreachable
	h.wantSent(1)

	h.target.down.Store(false)
	h.sender.fail = true
	h.tick(time.Minute) // back, but the push fails
	h.sender.fail = false
	h.tick(time.Minute)
	h.wantSent(2)
	if back := h.sender.sent[1]; back.title != "desktop is back" || back.body != "down 5 min" {
		t.Fatalf("alarm = %+v, want the retried \"desktop is back\", \"down 5 min\"", back)
	}
	h.tick(time.Minute)
	h.wantSent(2)
}
