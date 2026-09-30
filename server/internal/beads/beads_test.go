package beads

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// fakeRunner answers a canned Result, recording the argv it was given.
type fakeRunner struct {
	argv   []string
	result Result
	err    error
}

func (f *fakeRunner) run(ctx context.Context, argv []string) (Result, error) {
	f.argv = argv
	return f.result, f.err
}

func TestGetRunsTheCommandWithTheIDAsItsOwnArgument(t *testing.T) {
	runner := &fakeRunner{result: Result{Stdout: []byte("QkIQ-detail")}}
	fetcher := New("  mw   postern bead ", WithRunner(runner.run))

	out, err := fetcher.Get(context.Background(), "mw-abc.3")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if string(out) != "QkIQ-detail" {
		t.Fatalf("out = %q, want the command's stdout", out)
	}
	if want := []string{"mw", "postern", "bead", "mw-abc.3"}; !reflect.DeepEqual(runner.argv, want) {
		t.Fatalf("argv = %q, want %q", runner.argv, want)
	}

	// The configured argv is not appended to in place across calls.
	fetcher.Get(context.Background(), "mw-xyz")
	if want := []string{"mw", "postern", "bead", "mw-xyz"}; !reflect.DeepEqual(runner.argv, want) {
		t.Fatalf("second argv = %q, want %q", runner.argv, want)
	}
}

func TestGetValidatesTheIDBeforeAnythingElse(t *testing.T) {
	runner := &fakeRunner{}
	for _, id := range []string{"", ".hidden", "-rf", "mw abc", "mw/abc", "a;b", strings.Repeat("a", 65)} {
		for _, fetcher := range []*Fetcher{New("mw postern bead", WithRunner(runner.run)), New("")} {
			if _, err := fetcher.Get(context.Background(), id); !errors.Is(err, ErrInvalidID) {
				t.Fatalf("Get(%q) = %v, want ErrInvalidID", id, err)
			}
		}
	}
	if runner.argv != nil {
		t.Fatalf("the command ran for an invalid id: %q", runner.argv)
	}
	if _, err := New("mw", WithRunner(runner.run)).Get(context.Background(), strings.Repeat("a", 64)); err != nil {
		t.Fatalf("Get of a 64-character id: %v", err)
	}
}

func TestGetWithNoCommandIsNotConfigured(t *testing.T) {
	if _, err := New("   ").Get(context.Background(), "mw-abc"); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("Get = %v, want ErrNotConfigured", err)
	}
}

func TestGetMapsExitStatus3ToNotFound(t *testing.T) {
	runner := &fakeRunner{result: Result{ExitCode: 3, Stderr: []byte("no such bead")}}
	if _, err := New("mw", WithRunner(runner.run)).Get(context.Background(), "mw-abc"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Get = %v, want ErrNotFound", err)
	}
}

func TestGetReportsAnyOtherFailureWithAStderrSnippet(t *testing.T) {
	runner := &fakeRunner{result: Result{ExitCode: 1, Stderr: []byte("bd: database locked\n" + strings.Repeat("x", 1000))}}
	_, err := New("mw", WithRunner(runner.run)).Get(context.Background(), "mw-abc")
	var cmdErr *CommandError
	if !errors.As(err, &cmdErr) {
		t.Fatalf("Get = %v, want a *CommandError", err)
	}
	if !strings.Contains(err.Error(), "exit 1") || !strings.Contains(err.Error(), "bd: database locked") {
		t.Fatalf("error = %q, want the exit status and the start of stderr", err)
	}
	if len(err.Error()) > 400 {
		t.Fatalf("error is %d bytes long, want a short snippet", len(err.Error()))
	}

	runner = &fakeRunner{err: errors.New("exec: \"mw\": executable file not found in $PATH")}
	if _, err := New("mw", WithRunner(runner.run)).Get(context.Background(), "mw-abc"); !errors.As(err, &cmdErr) {
		t.Fatalf("Get = %v, want a *CommandError when the command cannot start", err)
	}
}

func TestGetGivesUpAfterTheTimeout(t *testing.T) {
	blocking := func(ctx context.Context, argv []string) (Result, error) {
		<-ctx.Done()
		return Result{ExitCode: -1}, ctx.Err()
	}
	start := time.Now()
	_, err := New("mw", WithRunner(blocking), WithTimeout(20*time.Millisecond)).Get(context.Background(), "mw-abc")
	var cmdErr *CommandError
	if !errors.As(err, &cmdErr) || !strings.Contains(err.Error(), "no answer within") {
		t.Fatalf("Get = %v, want a timeout *CommandError", err)
	}
	if time.Since(start) > 2*time.Second {
		t.Fatalf("Get took %s, want it to give up at the timeout", time.Since(start))
	}
}

func TestExecRunnerRunsARealCommandWithoutAShell(t *testing.T) {
	script := filepath.Join(t.TempDir(), "bead")
	body := "#!/bin/sh\nif [ \"$1\" = missing ]; then echo 'no such bead' >&2; exit 3; fi\nprintf 'detail of %s' \"$1\"\n"
	if err := os.WriteFile(script, []byte(body), 0o755); err != nil {
		t.Fatalf("writing script: %v", err)
	}
	fetcher := New(script)

	out, err := fetcher.Get(context.Background(), "mw-abc.3")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if string(out) != "detail of mw-abc.3" {
		t.Fatalf("out = %q", out)
	}
	if _, err := fetcher.Get(context.Background(), "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Get(missing) = %v, want ErrNotFound", err)
	}
}

func TestGetExit3ThatSaysSomethingElseIsAFailureWithItsReason(t *testing.T) {
	runner := &fakeRunner{result: Result{ExitCode: 3, Stderr: []byte(strings.Repeat("x", 500) + "\ndatabase is locked\n")}}
	_, err := New("mw", WithRunner(runner.run)).Get(context.Background(), "mw-abc")
	var cmdErr *CommandError
	if !errors.As(err, &cmdErr) {
		t.Fatalf("Get = %v, want a *CommandError", err)
	}
	if !strings.HasPrefix(cmdErr.Reason, "exit 3: ") || !strings.HasSuffix(cmdErr.Reason, "database is locked") {
		t.Fatalf("Reason = %q, want the exit status and the end of stderr", cmdErr.Reason)
	}
	if len(cmdErr.Reason) > len("exit 3: ")+stderrTailBytes {
		t.Fatalf("Reason is %d bytes long, want the last %d bytes of stderr at most", len(cmdErr.Reason), stderrTailBytes)
	}
}

func TestGetTimeoutReasonAndElapsed(t *testing.T) {
	blocking := func(ctx context.Context, argv []string) (Result, error) {
		<-ctx.Done()
		return Result{ExitCode: -1}, ctx.Err()
	}
	_, err := New("mw", WithRunner(blocking), WithTimeout(20*time.Millisecond)).Get(context.Background(), "mw-abc")
	var cmdErr *CommandError
	if !errors.As(err, &cmdErr) {
		t.Fatalf("Get = %v, want a *CommandError", err)
	}
	if !strings.HasPrefix(cmdErr.Reason, "timeout") || !strings.Contains(cmdErr.Msg, "timeout") || cmdErr.Elapsed < 20*time.Millisecond {
		t.Fatalf("Reason = %q, Msg = %q, Elapsed = %s", cmdErr.Reason, cmdErr.Msg, cmdErr.Elapsed)
	}
}
