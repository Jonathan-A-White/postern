package hook

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/index"
)

// fakeRunner counts runs and the most that were ever running at once; each
// run blocks until release is closed (if set) and then reports on done.
type fakeRunner struct {
	mu          sync.Mutex
	runs        int
	running     int
	maxRunning  int
	release     chan struct{}
	started     chan struct{}
	done        chan struct{}
	gotDeadline time.Duration
}

func newFakeRunner() *fakeRunner {
	return &fakeRunner{started: make(chan struct{}, 100), done: make(chan struct{}, 100)}
}

func (f *fakeRunner) run(ctx context.Context) ([]byte, error) {
	f.mu.Lock()
	f.runs++
	f.running++
	if f.running > f.maxRunning {
		f.maxRunning = f.running
	}
	if deadline, ok := ctx.Deadline(); ok {
		f.gotDeadline = time.Until(deadline)
	}
	release := f.release
	f.mu.Unlock()
	f.started <- struct{}{}

	if release != nil {
		<-release
	}

	f.mu.Lock()
	f.running--
	f.mu.Unlock()
	f.done <- struct{}{}
	return []byte("applied 1 action"), nil
}

func (f *fakeRunner) counts() (runs, maxRunning int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.runs, f.maxRunning
}

func waitFor(t *testing.T, ch <-chan struct{}, what string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for %s", what)
	}
}

func expectQuiet(t *testing.T, ch <-chan struct{}, what string) {
	t.Helper()
	select {
	case <-ch:
		t.Fatalf("unexpected %s", what)
	case <-time.After(100 * time.Millisecond):
	}
}

func TestABurstOfRecordsRunsTheHookOnce(t *testing.T) {
	runner := newFakeRunner()
	hook := New("mw postern inbox --apply", WithRunner(runner.run), WithDebounce(30*time.Millisecond), WithLogf(t.Logf))

	for seq := uint64(1); seq <= 5; seq++ {
		hook.RecordIndexed(index.Record{Seq: seq})
	}
	waitFor(t, runner.started, "the run to start")
	waitFor(t, runner.done, "the run")
	expectQuiet(t, runner.started, "second run after a single burst")

	if runs, _ := runner.counts(); runs != 1 {
		t.Fatalf("runs = %d, want 1 for one burst", runs)
	}

	// A later record runs it again.
	hook.RecordIndexed(index.Record{Seq: 6})
	waitFor(t, runner.done, "the next run")
	if runs, _ := runner.counts(); runs != 2 {
		t.Fatalf("runs = %d, want 2", runs)
	}
}

func TestRecordsDuringARunRunItExactlyOnceMoreAfterward(t *testing.T) {
	runner := newFakeRunner()
	runner.release = make(chan struct{})
	hook := New("x", WithRunner(runner.run), WithDebounce(10*time.Millisecond), WithLogf(t.Logf))

	hook.Trigger()
	waitFor(t, runner.started, "the first run to start")

	for i := 0; i < 3; i++ {
		hook.Trigger()
		time.Sleep(20 * time.Millisecond) // well past the debounce
	}
	expectQuiet(t, runner.started, "a second run while the first is still running")

	runner.mu.Lock()
	release := runner.release
	runner.release = nil
	runner.mu.Unlock()
	close(release)

	waitFor(t, runner.done, "the first run to end")
	waitFor(t, runner.started, "the one extra run to start")
	waitFor(t, runner.done, "the one extra run")
	expectQuiet(t, runner.started, "a third run")

	runs, maxRunning := runner.counts()
	if runs != 2 {
		t.Fatalf("runs = %d, want the first plus exactly one more", runs)
	}
	if maxRunning != 1 {
		t.Fatalf("at most %d runs at once, want 1", maxRunning)
	}
}

func TestEachRunHasTheTimeout(t *testing.T) {
	runner := newFakeRunner()
	hook := New("x", WithRunner(runner.run), WithDebounce(time.Millisecond), WithTimeout(5*time.Minute), WithLogf(t.Logf))
	hook.Trigger()
	waitFor(t, runner.done, "the run")

	runner.mu.Lock()
	defer runner.mu.Unlock()
	if runner.gotDeadline <= 4*time.Minute || runner.gotDeadline > 5*time.Minute {
		t.Fatalf("run's deadline was %s away, want about 5 minutes", runner.gotDeadline)
	}
}

func TestTheOutputIsLogged(t *testing.T) {
	runner := newFakeRunner()
	var mu sync.Mutex
	var logged []string
	logf := func(format string, args ...any) {
		mu.Lock()
		defer mu.Unlock()
		logged = append(logged, fmt.Sprintf(format, args...))
	}
	hook := New("x", WithRunner(runner.run), WithDebounce(time.Millisecond), WithLogf(logf))
	hook.Trigger()
	waitFor(t, runner.done, "the run")

	deadline := time.Now().Add(2 * time.Second)
	for {
		mu.Lock()
		all := strings.Join(logged, "\n")
		mu.Unlock()
		if strings.Contains(all, "applied 1 action") {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("log = %q, want the hook's output in it", all)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestTheDefaultRunnerRunsTheCommandThroughTheShell(t *testing.T) {
	out := filepath.Join(t.TempDir(), "ran")
	hook := New("printf ok > "+out+" && printf done", WithDebounce(time.Millisecond), WithLogf(t.Logf))
	hook.Trigger()

	deadline := time.Now().Add(3 * time.Second)
	for {
		if data, err := os.ReadFile(out); err == nil && string(data) == "ok" {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("the shell command never ran")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestANilHookIsANoOp(t *testing.T) {
	var hook *Hook
	hook.Trigger()
	hook.RecordIndexed(index.Record{Seq: 1})
}
