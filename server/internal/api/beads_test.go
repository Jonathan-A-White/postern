package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

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

// The phone gives up on any /api call after 30 s (src/services/apiAuth.ts), so
// the bead command must be cut off, and answered as 502, before that.
func TestBeadCommandTimeoutIsShorterThanThePhonesPatience(t *testing.T) {
	if beads.DefaultTimeout != 25*time.Second {
		t.Fatalf("DefaultTimeout = %s, want 25s", beads.DefaultTimeout)
	}
}

func TestBeadDetailAnswers502WhenTheCommandIsSlowerThanTheTimeout(t *testing.T) {
	slow := func(ctx context.Context, argv []string) (beads.Result, error) {
		<-ctx.Done()
		return beads.Result{ExitCode: -1}, ctx.Err()
	}
	server, _ := newServerWithOptions(t, WithBeads(beads.New("mw postern bead", beads.WithRunner(slow), beads.WithTimeout(20*time.Millisecond))))

	resp := doAuthorized(t, http.MethodGet, server.URL+"/api/beads/mw-abc", nil, server)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", resp.StatusCode)
	}
	var out struct {
		Error string `json:"error"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	if !strings.Contains(out.Error, "no answer within") {
		t.Fatalf("error = %q, want it to say there was no answer in time", out.Error)
	}
}

// A failed bead command leaves one journal line: the bead id, the seconds it
// ran and why (mw-t64a3.29); the 502's body says the same in short.
func TestBeadTimeoutLogsOneLineAndTheBodyNamesIt(t *testing.T) {
	logged := captureLog(t)
	blocking := func(ctx context.Context, argv []string) (beads.Result, error) {
		<-ctx.Done()
		return beads.Result{ExitCode: -1}, ctx.Err()
	}
	server, _ := newServerWithOptions(t, WithBeads(beads.New("mw postern bead", beads.WithRunner(blocking), beads.WithTimeout(30*time.Millisecond))))

	resp := doAuthorized(t, http.MethodGet, server.URL+"/api/beads/mw-slow.1", nil, server)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", resp.StatusCode)
	}
	var out struct {
		Error string `json:"error"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	if !strings.Contains(out.Error, "timeout") {
		t.Fatalf("error = %q, want it to name the timeout", out.Error)
	}
	lines := logLines(logged)
	if len(lines) != 1 {
		t.Fatalf("log = %q, want exactly one line", lines)
	}
	for _, want := range []string{"mw-slow.1", "0.0s", "timeout"} {
		if !strings.Contains(lines[0], want) {
			t.Fatalf("log line %q does not mention %q", lines[0], want)
		}
	}
}

func TestBeadExitWithStderrLogsOneLineAndTheBodyCarriesIt(t *testing.T) {
	logged := captureLog(t)
	runner := func(ctx context.Context, argv []string) (beads.Result, error) {
		return beads.Result{ExitCode: 3, Stderr: []byte("Error: database is locked\n")}, nil
	}
	server, _ := newServerWithOptions(t, WithBeads(beads.New("mw postern bead", beads.WithRunner(runner))))

	resp := doAuthorized(t, http.MethodGet, server.URL+"/api/beads/mw-locked.2", nil, server)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", resp.StatusCode)
	}
	var out struct {
		Error string `json:"error"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	for _, want := range []string{"exit 3", "database is locked"} {
		if !strings.Contains(out.Error, want) {
			t.Fatalf("error = %q, want it to mention %q", out.Error, want)
		}
	}
	lines := logLines(logged)
	if len(lines) != 1 {
		t.Fatalf("log = %q, want exactly one line", lines)
	}
	for _, want := range []string{"mw-locked.2", "exit 3", "database is locked"} {
		if !strings.Contains(lines[0], want) {
			t.Fatalf("log line %q does not mention %q", lines[0], want)
		}
	}
}

func TestBeadLogKeepsTheLast300BytesOfStderrOnOneLine(t *testing.T) {
	logged := captureLog(t)
	stderr := strings.Repeat("noise\n", 200) + "the real cause\nsecond line"
	runner := func(ctx context.Context, argv []string) (beads.Result, error) {
		return beads.Result{ExitCode: 1, Stderr: []byte(stderr)}, nil
	}
	server, _ := newServerWithOptions(t, WithBeads(beads.New("mw postern bead", beads.WithRunner(runner))))

	resp := doAuthorized(t, http.MethodGet, server.URL+"/api/beads/mw-noisy", nil, server)
	resp.Body.Close()
	lines := logLines(logged)
	if len(lines) != 1 {
		t.Fatalf("log = %q, want exactly one line", lines)
	}
	if !strings.Contains(lines[0], "the real cause second line") || len(lines[0]) > 500 {
		t.Fatalf("log line %q (%d bytes), want the tail of stderr, short", lines[0], len(lines[0]))
	}
}

func TestBeadSuccessAndNotFoundWriteNoLogLine(t *testing.T) {
	logged := captureLog(t)
	for _, result := range []beads.Result{
		{Stdout: []byte("QkIQ-bead")},
		{ExitCode: 3, Stderr: []byte(`Error: mw postern bead: there is no bead "mw-abc"`)},
		{ExitCode: 3},
	} {
		result := result
		runner := func(ctx context.Context, argv []string) (beads.Result, error) { return result, nil }
		server, _ := newServerWithOptions(t, WithBeads(beads.New("mw postern bead", beads.WithRunner(runner))))
		resp := doAuthorized(t, http.MethodGet, server.URL+"/api/beads/mw-abc", nil, server)
		resp.Body.Close()
	}
	if lines := logLines(logged); len(lines) != 0 {
		t.Fatalf("log = %q, want nothing for a bead that answered or is not there", lines)
	}
}
