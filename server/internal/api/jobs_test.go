package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/Jonathan-A-White/postern/server/internal/jobs"
)

func newJobsServer(t *testing.T, files map[string]string) gristServer {
	t.Helper()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "jobs"), 0o755); err != nil {
		t.Fatal(err)
	}
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(dir, "jobs", name), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return newGristServer(t, WithJobs(jobs.Open(dir)))
}

const subsplashJob = `{"id":"subsplash-links","title":"Subsplash links","updated":"2026-11-11T18:00:00Z","checks":["mail","link"],
"items":[{"label":"Romans 8","done":{"mail":true,"link":true}},{"label":"Romans 7","done":{"mail":true}}],"here":1}`

func TestGetJobsListsEachJobFromItsFile(t *testing.T) {
	s := newJobsServer(t, map[string]string{"subsplash-links.json": subsplashJob, "broken.json": "{nope"})
	resp := s.do(t, "governor", http.MethodGet, "/api/jobs", "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d, want 200 (a bad file is skipped, not a 500)", resp.StatusCode)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", cc)
	}
	var body struct {
		Jobs []struct {
			ID      string `json:"id"`
			Title   string `json:"title"`
			Updated string `json:"updated"`
			Done    int    `json:"done"`
			Total   int    `json:"total"`
		} `json:"jobs"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Jobs) != 1 || body.Jobs[0].ID != "subsplash-links" || body.Jobs[0].Done != 1 || body.Jobs[0].Total != 2 || body.Jobs[0].Title != "Subsplash links" {
		t.Fatalf("jobs = %+v", body.Jobs)
	}
}

func TestGetJobsWithNoneIsAnEmptyListNotNull(t *testing.T) {
	s := newJobsServer(t, nil)
	resp := s.do(t, "governor", http.MethodGet, "/api/jobs", "")
	defer resp.Body.Close()
	var raw map[string]json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		t.Fatal(err)
	}
	if string(raw["jobs"]) != "[]" {
		t.Fatalf("jobs = %s, want []", raw["jobs"])
	}
}

func TestGetJobServesTheWholeFeed(t *testing.T) {
	s := newJobsServer(t, map[string]string{"subsplash-links.json": subsplashJob})
	resp := s.do(t, "governor", http.MethodGet, "/api/jobs/subsplash-links", "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d, want 200", resp.StatusCode)
	}
	var j jobs.Job
	if err := json.NewDecoder(resp.Body).Decode(&j); err != nil {
		t.Fatal(err)
	}
	if j.ID != "subsplash-links" || len(j.Checks) != 2 || len(j.Items) != 2 || j.Items[1].Label != "Romans 7" || j.Here == nil || *j.Here != 1 {
		t.Fatalf("job = %+v", j)
	}
}

func TestGetJobIsA404ForAnUnknownOrBadFile(t *testing.T) {
	s := newJobsServer(t, map[string]string{"broken.json": "{nope"})
	for _, id := range []string{"nope", "broken"} {
		resp := s.do(t, "governor", http.MethodGet, "/api/jobs/"+id, "")
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("GET /api/jobs/%s: status %d, want 404", id, resp.StatusCode)
		}
	}
}

func TestJobsAreForACockpitKeyOnly(t *testing.T) {
	s := newJobsServer(t, map[string]string{"subsplash-links.json": subsplashJob})
	for _, as := range []string{"cairnPhone", "mill"} {
		for _, path := range []string{"/api/jobs", "/api/jobs/subsplash-links"} {
			resp := s.do(t, as, http.MethodGet, path, "")
			resp.Body.Close()
			if resp.StatusCode != http.StatusForbidden {
				t.Errorf("GET %s as %s: status %d, want 403", path, as, resp.StatusCode)
			}
		}
	}
}

func TestJobsWithoutAStoreAnswer501(t *testing.T) {
	s := newGristServer(t)
	resp := s.do(t, "governor", http.MethodGet, "/api/jobs", "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotImplemented {
		t.Fatalf("status %d, want 501", resp.StatusCode)
	}
}
