// Package hook runs the on-message hook (POSTERN_ON_MESSAGE): a shell
// command run after records are indexed — on the factory's host,
// `mw postern inbox --apply`, which applies the Governor's actions
// (docs/protocol.md §13). Runs are debounced so a burst of records costs one
// run, never overlap, and a record that arrives mid-run earns exactly one
// more run once the current one ends.
package hook

import (
	"context"
	"log"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/index"
)

const (
	// DefaultDebounce is how long after the first record of a burst the hook
	// runs; every record in that window shares the one run.
	DefaultDebounce = time.Second
	// DefaultTimeout is how long one run may take before it is killed. It
	// outlasts the longest thing the on-message hook (`mw postern inbox
	// --apply`) may do: wait up to 12 minutes for its lock and then run a
	// hands step for up to 10 (docs/protocol.md §17). A shorter limit would
	// kill a step after its approval was spent, with no outcome recorded.
	DefaultTimeout = 25 * time.Minute
	// maxLoggedOutput caps how much of a run's output is logged.
	maxLoggedOutput = 4096
)

// Runner runs the hook once, until it exits or ctx ends, returning its
// combined output.
type Runner func(ctx context.Context) ([]byte, error)

// Hook runs its command after records are indexed. Safe for concurrent use;
// a nil *Hook does nothing.
type Hook struct {
	command  string
	run      Runner
	debounce time.Duration
	timeout  time.Duration
	logf     func(format string, args ...any)

	mu      sync.Mutex
	armed   bool // a debounce timer is pending
	running bool
	again   bool // triggered while running: run once more after
}

// Option configures a Hook constructed by New.
type Option func(*Hook)

// WithRunner overrides running the command through sh -c.
func WithRunner(run Runner) Option {
	return func(h *Hook) { h.run = run }
}

// WithDebounce overrides DefaultDebounce.
func WithDebounce(d time.Duration) Option {
	return func(h *Hook) { h.debounce = d }
}

// WithTimeout overrides DefaultTimeout.
func WithTimeout(d time.Duration) Option {
	return func(h *Hook) { h.timeout = d }
}

// WithLogf overrides log.Printf for the hook's output and failures.
func WithLogf(logf func(format string, args ...any)) Option {
	return func(h *Hook) { h.logf = logf }
}

// New builds a Hook that runs command through `sh -c`.
func New(command string, opts ...Option) *Hook {
	h := &Hook{command: command, debounce: DefaultDebounce, timeout: DefaultTimeout, logf: log.Printf}
	h.run = h.shell
	for _, opt := range opts {
		opt(h)
	}
	return h
}

// RecordIndexed triggers the hook. It makes *Hook a notify.Notifier.
func (h *Hook) RecordIndexed(index.Record) {
	h.Trigger()
}

// Trigger asks for a run and returns at once. The run starts one debounce
// after the first trigger of a quiet spell, taking in every trigger since;
// a trigger while a run is going asks for one more run after it.
func (h *Hook) Trigger() {
	if h == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	switch {
	case h.running:
		h.again = true
	case h.armed:
		// Already due to run; this trigger shares it.
	default:
		h.armed = true
		time.AfterFunc(h.debounce, h.fire)
	}
}

// fire starts the runs a debounce timer was armed for.
func (h *Hook) fire() {
	h.mu.Lock()
	h.armed = false
	if h.running {
		h.again = true
		h.mu.Unlock()
		return
	}
	h.running = true
	h.mu.Unlock()

	for {
		h.runOnce()

		h.mu.Lock()
		if !h.again {
			h.running = false
			h.mu.Unlock()
			return
		}
		h.again = false
		h.mu.Unlock()
	}
}

// runOnce runs the hook with its timeout and logs what it said.
func (h *Hook) runOnce() {
	ctx, cancel := context.WithTimeout(context.Background(), h.timeout)
	defer cancel()

	output, err := h.run(ctx)
	text := strings.TrimSpace(string(output))
	if len(text) > maxLoggedOutput {
		text = text[:maxLoggedOutput] + "…"
	}
	switch {
	case err != nil && text != "":
		h.logf("on-message hook failed: %v; output: %s", err, text)
	case err != nil:
		h.logf("on-message hook failed: %v", err)
	case text != "":
		h.logf("on-message hook: %s", text)
	}
}

// shell runs the command through sh -c, killed if ctx ends first.
func (h *Hook) shell(ctx context.Context) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "sh", "-c", h.command)
	cmd.WaitDelay = 5 * time.Second // don't wait on a grandchild holding the pipes
	return cmd.CombinedOutput()
}
