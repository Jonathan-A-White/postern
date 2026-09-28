package api

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Jonathan-A-White/postern/server/internal/view"
)

func TestViewServesTheFileWithItsETag(t *testing.T) {
	path := filepath.Join(t.TempDir(), "postern-view.txt")
	if err := os.WriteFile(path, []byte("QkIQMwOdGrrs"), 0o644); err != nil {
		t.Fatalf("writing view: %v", err)
	}
	server, _ := newServerWithOptions(t, WithView(view.New(path)))

	resp := doAuthorized(t, http.MethodGet, server.URL+"/api/view", nil, server)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/plain") {
		t.Fatalf("Content-Type = %q, want text/plain", ct)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", cc)
	}
	if etag := resp.Header.Get("ETag"); etag != view.ETagOf([]byte("QkIQMwOdGrrs")) {
		t.Fatalf("ETag = %q, want the quoted sha256 of the bytes", etag)
	}
	body, _ := io.ReadAll(resp.Body)
	if string(body) != "QkIQMwOdGrrs" {
		t.Fatalf("body = %q, want the file's bytes", body)
	}
}

func TestViewAnswers304ForAMatchingIfNoneMatch(t *testing.T) {
	path := filepath.Join(t.TempDir(), "postern-view.txt")
	if err := os.WriteFile(path, []byte("QkIQMwOdGrrs"), 0o644); err != nil {
		t.Fatalf("writing view: %v", err)
	}
	server, _ := newServerWithOptions(t, WithView(view.New(path)))
	etag := view.ETagOf([]byte("QkIQMwOdGrrs"))

	for _, ifNoneMatch := range []string{etag, `"stale", ` + etag, "W/" + etag} {
		req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/view", nil)
		req.Header = authorizedRequest(t, server)
		req.Header.Set("If-None-Match", ifNoneMatch)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("GET /api/view: %v", err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotModified {
			t.Fatalf("If-None-Match %s: status = %d, want 304", ifNoneMatch, resp.StatusCode)
		}
		if len(body) != 0 || resp.Header.Get("ETag") != etag || resp.Header.Get("Cache-Control") != "no-store" {
			t.Fatalf("304 = body %q, ETag %q, Cache-Control %q", body, resp.Header.Get("ETag"), resp.Header.Get("Cache-Control"))
		}
	}

	req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/view", nil)
	req.Header = authorizedRequest(t, server)
	req.Header.Set("If-None-Match", `"stale"`)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /api/view: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("stale If-None-Match: status = %d, want 200", resp.StatusCode)
	}
}

func TestViewAnswers404WhenNoViewIsWrittenOrConfigured(t *testing.T) {
	missing := view.New(filepath.Join(t.TempDir(), "never-written.txt"))
	for name, opts := range map[string][]Option{
		"unset":       nil,
		"not written": {WithView(missing)},
	} {
		t.Run(name, func(t *testing.T) {
			server, _ := newServerWithOptions(t, opts...)
			resp := doAuthorized(t, http.MethodGet, server.URL+"/api/view", nil, server)
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusNotFound {
				t.Fatalf("status = %d, want 404", resp.StatusCode)
			}
			var out struct {
				Error string `json:"error"`
			}
			json.NewDecoder(resp.Body).Decode(&out)
			if out.Error != "no view written yet" {
				t.Fatalf("error = %q, want %q", out.Error, "no view written yet")
			}
		})
	}
}

func TestViewRequiresAuthorization(t *testing.T) {
	server, _ := newServerWithOptions(t)
	resp, err := http.Get(server.URL + "/api/view")
	if err != nil {
		t.Fatalf("GET /api/view: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}
