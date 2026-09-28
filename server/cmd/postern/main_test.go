package main

import (
	"io"
	"net/http"
	"net/http/httptest"
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
