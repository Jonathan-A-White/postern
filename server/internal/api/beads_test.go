package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/Jonathan-A-White/postern/server/internal/beads"
)

func TestBeadDetailAnswersTheCommandsOutput(t *testing.T) {
	var gotArgv []string
	runner := func(ctx context.Context, argv []string) (beads.Result, error) {
		gotArgv = argv
		return beads.Result{Stdout: []byte("QkIQ-bead")}, nil
	}
	server, _ := newServerWithOptions(t, WithBeads(beads.New("mw postern bead", beads.WithRunner(runner))))

	resp := doAuthorized(t, http.MethodGet, server.URL+"/api/beads/mw-abc.3", nil, server)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/plain") {
		t.Fatalf("Content-Type = %q, want text/plain", ct)
	}
	body, _ := io.ReadAll(resp.Body)
	if string(body) != "QkIQ-bead" {
		t.Fatalf("body = %q", body)
	}
	if strings.Join(gotArgv, " ") != "mw postern bead mw-abc.3" {
		t.Fatalf("argv = %q", gotArgv)
	}
}

func TestBeadDetailMapsEachFailure(t *testing.T) {
	failing := func(result beads.Result) Option {
		return WithBeads(beads.New("mw postern bead", beads.WithRunner(func(ctx context.Context, argv []string) (beads.Result, error) {
			return result, nil
		})))
	}
	for _, tc := range []struct {
		name      string
		opts      []Option
		id        string
		status    int
		errorPart string
	}{
		{"invalid id", []Option{failing(beads.Result{})}, "-rf", http.StatusBadRequest, "bead id"},
		{"invalid id, unconfigured", nil, ".x", http.StatusBadRequest, "bead id"},
		{"unconfigured", nil, "mw-abc", http.StatusNotImplemented, "POSTERN_BEAD_CMD"},
		{"no such bead", []Option{failing(beads.Result{ExitCode: 3})}, "mw-abc", http.StatusNotFound, "no such bead"},
		{"command failed", []Option{failing(beads.Result{ExitCode: 1, Stderr: []byte("bd: locked")})}, "mw-abc", http.StatusBadGateway, "bd: locked"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server, _ := newServerWithOptions(t, tc.opts...)
			resp := doAuthorized(t, http.MethodGet, server.URL+"/api/beads/"+tc.id, nil, server)
			defer resp.Body.Close()
			if resp.StatusCode != tc.status {
				t.Fatalf("status = %d, want %d", resp.StatusCode, tc.status)
			}
			var out struct {
				Error string `json:"error"`
			}
			json.NewDecoder(resp.Body).Decode(&out)
			if !strings.Contains(out.Error, tc.errorPart) {
				t.Fatalf("error = %q, want it to mention %q", out.Error, tc.errorPart)
			}
		})
	}
}

func TestBeadDetailRequiresAuthorization(t *testing.T) {
	server, _ := newServerWithOptions(t)
	resp, err := http.Get(server.URL + "/api/beads/mw-abc")
	if err != nil {
		t.Fatalf("GET /api/beads: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}
