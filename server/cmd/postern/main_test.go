package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/api"
	"github.com/Jonathan-A-White/postern/server/internal/auth"
	"github.com/Jonathan-A-White/postern/server/internal/blobs"
	"github.com/Jonathan-A-White/postern/server/internal/config"
	"github.com/Jonathan-A-White/postern/server/internal/events"
	"github.com/Jonathan-A-White/postern/server/internal/index"
	"github.com/Jonathan-A-White/postern/server/internal/push"
	"github.com/Jonathan-A-White/postern/server/internal/standby"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
)

// stubChecker is a LicenceChecker test double that never touches a chain.
type stubChecker struct{ held bool }

func (c *stubChecker) Held(pubKeyHex string) (bool, error) { return c.held, nil }

func TestHealthz(t *testing.T) {
	store, err := index.Open(t.TempDir())
	if err != nil {
		t.Fatalf("index.Open: %v", err)
	}
	defer store.Close()
	client := woc.NewClient("http://unused.invalid")
	pushStore, err := push.OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("push.OpenStore: %v", err)
	}
	blobStore, err := blobs.OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("blobs.OpenStore: %v", err)
	}

	nonces := auth.NewNonceStore(time.Minute)
	server := httptest.NewServer(api.NewHandler(store, client, "test-vapid-public-key", pushStore, blobStore, nonces, &stubChecker{held: true}))
	defer server.Close()

	resp, err := http.Get(server.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("reading body: %v", err)
	}

	if string(body) != "ok" {
		t.Fatalf("body = %q, want %q", string(body), "ok")
	}
}

func TestAppServesTheV2RoutesBehindTheLicenceProof(t *testing.T) {
	cfg, err := config.Load(func(key string) string {
		return map[string]string{
			"POSTERN_ANCHOR":     "mt6vaAWeFxu2qC6pPs7bsqTNvv87dCwMW5",
			"POSTERN_DATA":       t.TempDir(),
			"POSTERN_WOC_BASE":   "http://unused.invalid",
			"POSTERN_ON_MESSAGE": "true",
			"POSTERN_BEAD_CMD":   "mw postern bead",
			"POSTERN_VIEW_FILE":  "/nonexistent/postern-view.txt",
		}[key]
	})
	if err != nil {
		t.Fatalf("config.Load: %v", err)
	}
	app, err := newApp(cfg)
	if err != nil {
		t.Fatalf("newApp: %v", err)
	}
	defer app.close()
	server := httptest.NewServer(app.handler)
	defer server.Close()

	for _, route := range []struct{ method, path string }{
		{http.MethodPost, "/api/messages"},
		{http.MethodGet, "/api/events"},
		{http.MethodGet, "/api/view"},
		{http.MethodGet, "/api/beads/mw-abc"},
		{http.MethodGet, "/api/me"},
	} {
		req, _ := http.NewRequest(route.method, server.URL+route.path, nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s %s: %v", route.method, route.path, err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("%s %s = %d, want 401 (routed, and behind the licence proof)", route.method, route.path, resp.StatusCode)
		}
	}
}

// standbyApp builds the app with POSTERN_HOME_CMD set to homeCmd.
func standbyApp(t *testing.T, homeCmd string) *httptest.Server {
	t.Helper()
	cfg, err := config.Load(func(key string) string {
		return map[string]string{
			"POSTERN_ANCHOR":    "mt6vaAWeFxu2qC6pPs7bsqTNvv87dCwMW5",
			"POSTERN_DATA":      t.TempDir(),
			"POSTERN_WOC_BASE":  "http://unused.invalid",
			"POSTERN_VIEW_FILE": "/nonexistent/postern-view.txt",
			"POSTERN_HOME_CMD":  homeCmd,
		}[key]
	})
	if err != nil {
		t.Fatalf("config.Load: %v", err)
	}
	app, err := newApp(cfg)
	if err != nil {
		t.Fatalf("newApp: %v", err)
	}
	t.Cleanup(app.close)
	server := httptest.NewServer(app.handler)
	t.Cleanup(server.Close)
	return server
}

func get(t *testing.T, url string) (int, string) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(body)
}

func TestAppInStandbyAnswers503ExceptHealthzAndTheSendRoutes(t *testing.T) {
	server := standbyApp(t, "echo desktop; exit 1")

	code, body := get(t, server.URL+"/api/view")
	if code != http.StatusServiceUnavailable || !strings.Contains(body, `"standby":true`) || !strings.Contains(body, `"home":"desktop"`) {
		t.Fatalf("GET /api/view = %d %q, want 503 with standby true and the home", code, body)
	}
	code, body = get(t, server.URL+"/healthz")
	if code != http.StatusOK || !strings.Contains(body, `"standby":true`) {
		t.Fatalf("GET /healthz = %d %q, want 200 with standby true", code, body)
	}
	if code, _ = get(t, server.URL+"/api/challenge"); code != http.StatusOK {
		t.Fatalf("GET /api/challenge = %d, want 200 (a send needs it)", code)
	}
	// A send route is routed as usual: behind the licence proof, so 401.
	resp, err := http.Post(server.URL+"/api/broadcast", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("POST /api/broadcast = %d, want 401 (not 503)", resp.StatusCode)
	}
}

func TestAppAtHomeBehavesAsBefore(t *testing.T) {
	server := standbyApp(t, "exit 0")
	if code, body := get(t, server.URL+"/healthz"); code != http.StatusOK || body != "ok" {
		t.Fatalf("GET /healthz = %d %q, want 200 ok", code, body)
	}
	if code, _ := get(t, server.URL+"/api/view"); code != http.StatusUnauthorized {
		t.Fatalf("GET /api/view = %d, want 401", code)
	}
}

// recordingNotifier counts the records it is told about.
type recordingNotifier struct{ n atomic.Int32 }

func (r *recordingNotifier) RecordIndexed(index.Record) { r.n.Add(1) }

func TestStandbyPushesNothingButTheHookStillRuns(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "hook-ran")
	cfg := config.Config{OnMessage: "touch " + marker, HomeCmd: "exit 1"}
	mon := standby.New(cfg.HomeCmd)
	mon.Check()
	push := &recordingNotifier{}

	buildFanout(cfg, mon, push, events.NewHub()).RecordIndexed(index.Record{TxID: "direct:ab"})

	deadline := time.Now().Add(10 * time.Second)
	for {
		if _, err := os.Stat(marker); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the on-message hook did not run in standby")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if push.n.Load() != 0 {
		t.Fatalf("push was told about %d records in standby, want 0", push.n.Load())
	}
}

func TestAtHomePushIsSent(t *testing.T) {
	cfg := config.Config{HomeCmd: "exit 0"}
	mon := standby.New(cfg.HomeCmd)
	mon.Check()
	push := &recordingNotifier{}
	buildFanout(cfg, mon, push, events.NewHub()).RecordIndexed(index.Record{TxID: "direct:ab"})
	if push.n.Load() != 1 {
		t.Fatalf("push was told about %d records at home, want 1", push.n.Load())
	}
}

func TestGristForTheMillPicksOnlyGristAddressedToTheMill(t *testing.T) {
	const mill = "034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa"
	const other = "023c72addb4fdf09af94f0c94d7fe92a386a7e70cf8a1d85916386bb2535c7b1b1"
	payload := func(class, to string) index.Record {
		return index.Record{Payload: []byte(`{"v":1,"kind":"msg","class":"` + class + `","to":"` + to + `","from":"` + other + `","ts":1,"ct":"x"}`)}
	}
	forMill := gristForMill(mill)
	for _, tc := range []struct {
		name string
		rec  index.Record
		want bool
	}{
		{"grist to the mill", payload("grist", mill), true},
		{"grist to the mill, upper-cased", payload("grist", "034F355BDCB7CC0AF728EF3CCEB9615D90684BB5B2CA5F859AB0F0B704075871AA"), true},
		{"a grist answer to an app", payload("grist", other), false},
		{"a message to the mill", payload("message", mill), false},
		{"a record with no envelope", index.Record{}, false},
	} {
		if got := forMill(tc.rec); got != tc.want {
			t.Fatalf("%s: gristForMill = %v, want %v", tc.name, got, tc.want)
		}
	}
	if gristForMill("")(payload("grist", mill)) {
		t.Fatal("with no mill key, nothing is grist for the mill")
	}
}

func TestAppServesGristRoutesAndCORS(t *testing.T) {
	cfg, err := config.Load(func(key string) string {
		return map[string]string{
			"POSTERN_ANCHOR":       "mt6vaAWeFxu2qC6pPs7bsqTNvv87dCwMW5",
			"POSTERN_DATA":         t.TempDir(),
			"POSTERN_WOC_BASE":     "http://unused.invalid",
			"POSTERN_MILL_KEY":     "034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa",
			"POSTERN_APPS":         "cairn=cairn",
			"POSTERN_ON_GRIST":     "true",
			"POSTERN_CORS_ORIGINS": "https://jonathan-a-white.github.io",
		}[key]
	})
	if err != nil {
		t.Fatalf("config.Load: %v", err)
	}
	app, err := newApp(cfg)
	if err != nil {
		t.Fatalf("newApp: %v", err)
	}
	defer app.close()
	server := httptest.NewServer(app.handler)
	defer server.Close()

	del, _ := http.NewRequest(http.MethodDelete, server.URL+"/api/blobs/"+strings.Repeat("a", 64), nil)
	resp, err := http.DefaultClient.Do(del)
	if err != nil {
		t.Fatalf("DELETE /api/blobs: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("DELETE /api/blobs/{hash} = %d, want 401 (routed, and behind the licence proof)", resp.StatusCode)
	}

	preflight, _ := http.NewRequest(http.MethodOptions, server.URL+"/api/messages", nil)
	preflight.Header.Set("Origin", "https://jonathan-a-white.github.io")
	preflight.Header.Set("Access-Control-Request-Method", "POST")
	resp, err = http.DefaultClient.Do(preflight)
	if err != nil {
		t.Fatalf("preflight: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent || resp.Header.Get("Access-Control-Allow-Origin") == "" {
		t.Fatalf("preflight = %d %v, want 204 with CORS headers", resp.StatusCode, resp.Header)
	}
}

func TestFanoutSendsGristForTheMillToTheOnGristHookOnly(t *testing.T) {
	const mill = "034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa"
	const other = "023c72addb4fdf09af94f0c94d7fe92a386a7e70cf8a1d85916386bb2535c7b1b1"
	dir := t.TempDir()
	onMessage, onGrist := filepath.Join(dir, "on-message"), filepath.Join(dir, "on-grist")
	cfg := config.Config{MillKey: mill, OnMessage: "echo x >> " + onMessage, OnGrist: "echo x >> " + onGrist, HomeCmd: "exit 1"}
	mon := standby.New(cfg.HomeCmd)
	mon.Check()
	fanout := buildFanout(cfg, mon, &recordingNotifier{}, events.NewHub())

	fanout.RecordIndexed(index.Record{Payload: []byte(`{"v":1,"kind":"msg","class":"grist","to":"` + mill + `","from":"` + other + `","ts":1,"ct":"x"}`)})
	fanout.RecordIndexed(index.Record{Payload: []byte(`{"v":1,"kind":"msg","class":"message","to":"` + other + `","from":"` + other + `","ts":1,"ct":"x"}`)})

	lines := func(path string) int {
		b, _ := os.ReadFile(path)
		return strings.Count(string(b), "x")
	}
	deadline := time.Now().Add(10 * time.Second)
	for lines(onMessage) < 1 || lines(onGrist) < 1 {
		if time.Now().After(deadline) {
			t.Fatalf("hooks ran on-message %d, on-grist %d times, want 1 each (in standby too)", lines(onMessage), lines(onGrist))
		}
		time.Sleep(20 * time.Millisecond)
	}
	time.Sleep(200 * time.Millisecond)
	if lines(onMessage) != 1 || lines(onGrist) != 1 {
		t.Fatalf("hooks ran on-message %d, on-grist %d times, want 1 each", lines(onMessage), lines(onGrist))
	}
}
