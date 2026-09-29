package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/api"
	"github.com/Jonathan-A-White/postern/server/internal/auth"
	"github.com/Jonathan-A-White/postern/server/internal/blobs"
	"github.com/Jonathan-A-White/postern/server/internal/config"
	"github.com/Jonathan-A-White/postern/server/internal/index"
	"github.com/Jonathan-A-White/postern/server/internal/push"
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
