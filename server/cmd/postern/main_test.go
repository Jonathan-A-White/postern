package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/api"
	"github.com/Jonathan-A-White/postern/server/internal/auth"
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

	nonces := auth.NewNonceStore(time.Minute)
	server := httptest.NewServer(api.NewHandler(store, client, "test-vapid-public-key", pushStore, nonces, &stubChecker{held: true}))
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
