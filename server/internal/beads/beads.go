// Package beads fetches one bead's full detail (docs/protocol.md §12) by
// running POSTERN_BEAD_CMD — on the factory's host, `mw postern bead` —
// with the bead id appended as its own argument. The command is run
// directly, never through a shell, and its stdout (already encrypted to the
// Governor) is handed back as it stands.
package beads

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// DefaultTimeout is how long the command may run before Get gives up. It is
// shorter than the 30 s the phone waits for any /api call (src/services/apiAuth.ts),
// so the phone gets a 502 rather than a dropped request.
const DefaultTimeout = 25 * time.Second

// NotFoundExitCode is the exit status the command uses for "no such bead".
const NotFoundExitCode = 3

// stderrSnippetBytes caps how much of the command's stderr a CommandError
// quotes.
const stderrSnippetBytes = 200

// stderrTailBytes is how much of the end of stderr a CommandError keeps for
// the journal.
const stderrTailBytes = 300

var idPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

var (
	// ErrInvalidID is an id that is not ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$.
	ErrInvalidID = errors.New("bead id must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
	// ErrNotConfigured means no bead command is configured.
	ErrNotConfigured = errors.New("no POSTERN_BEAD_CMD is configured")
	// ErrNotFound means the command exited NotFoundExitCode.
	ErrNotFound = errors.New("no such bead")
)

// CommandError is any other failure of the command: a non-zero exit, a
// failure to start, or no answer within the timeout. Msg is the short form
// the phone is told; Reason is the fuller one for the journal (the last
// stderrTailBytes of stderr); Elapsed is how long the command ran.
type CommandError struct {
	Msg     string
	Reason  string
	Elapsed time.Duration
}

func (e *CommandError) Error() string { return e.Msg }

// Result is what one run of the command produced. ExitCode is -1 when the
// process did not exit normally (killed, or never started).
type Result struct {
	Stdout   []byte
	Stderr   []byte
	ExitCode int
}

// Runner runs argv (argv[0] the program, never a shell) until it exits or
// ctx ends. It reports a normal exit, zero or not, with a nil error.
type Runner func(ctx context.Context, argv []string) (Result, error)

// Fetcher runs the bead command. Safe for concurrent use.
type Fetcher struct {
	argv    []string
	run     Runner
	timeout time.Duration
}

// Option configures a Fetcher constructed by New.
type Option func(*Fetcher)

// WithRunner overrides ExecRunner, so tests never start a process.
func WithRunner(run Runner) Option {
	return func(f *Fetcher) { f.run = run }
}

// WithTimeout overrides DefaultTimeout.
func WithTimeout(d time.Duration) Option {
	return func(f *Fetcher) { f.timeout = d }
}

// New builds a Fetcher for commandLine, split on whitespace into argv
// ("" or blank for none configured). Quoting is not interpreted.
func New(commandLine string, opts ...Option) *Fetcher {
	f := &Fetcher{argv: strings.Fields(commandLine), run: ExecRunner, timeout: DefaultTimeout}
	for _, opt := range opts {
		opt(f)
	}
	return f
}

// Get validates id, runs the command with id appended and answers its
// stdout on exit 0. It returns ErrInvalidID, ErrNotConfigured, ErrNotFound
// (exit NotFoundExitCode, unless stderr says something else went wrong) or a
// *CommandError for anything else.
func (f *Fetcher) Get(ctx context.Context, id string) ([]byte, error) {
	if !idPattern.MatchString(id) {
		return nil, ErrInvalidID
	}
	if len(f.argv) == 0 {
		return nil, ErrNotConfigured
	}

	// The clock starts before the deadline is set, so a timed-out call's
	// Elapsed is never shorter than the timeout.
	start := time.Now()
	ctx, cancel := context.WithTimeout(ctx, f.timeout)
	defer cancel()

	argv := append(append(make([]string, 0, len(f.argv)+1), f.argv...), id)
	result, err := f.run(ctx, argv)
	elapsed := time.Since(start)
	switch {
	case errors.Is(ctx.Err(), context.DeadlineExceeded):
		return nil, &CommandError{
			Msg:     fmt.Sprintf("%s: timeout, no answer within %s", f.argv[0], f.timeout),
			Reason:  fmt.Sprintf("timeout after %s", f.timeout),
			Elapsed: elapsed,
		}
	case err != nil:
		return nil, &CommandError{
			Msg:     withSnippet(fmt.Sprintf("%s: %v", f.argv[0], err), result.Stderr),
			Reason:  withTail(fmt.Sprintf("%v", err), result.Stderr),
			Elapsed: elapsed,
		}
	case result.ExitCode == 0:
		return result.Stdout, nil
	case result.ExitCode == NotFoundExitCode && saysNoSuchBead(result.Stderr):
		return nil, ErrNotFound
	default:
		return nil, &CommandError{
			Msg:     withSnippet(fmt.Sprintf("%s: exit %d", f.argv[0], result.ExitCode), result.Stderr),
			Reason:  withTail(fmt.Sprintf("exit %d", result.ExitCode), result.Stderr),
			Elapsed: elapsed,
		}
	}
}

// saysNoSuchBead reports whether stderr is compatible with "no such bead":
// empty, or naming the missing bead as `mw postern bead` does ("there is no
// bead ..."). An exit 3 that says something else (a locked database, say) is
// a failure, not a missing bead.
func saysNoSuchBead(stderr []byte) bool {
	text := strings.ToLower(string(stderr))
	return strings.TrimSpace(text) == "" || strings.Contains(text, "no bead") || strings.Contains(text, "no such bead")
}

// withTail appends the last stderrTailBytes of stderr, on one line, to msg.
func withTail(msg string, stderr []byte) string {
	tail := stderr
	if len(tail) > stderrTailBytes {
		tail = tail[len(tail)-stderrTailBytes:]
		for len(tail) > 0 && !utf8.RuneStart(tail[0]) {
			tail = tail[1:]
		}
	}
	line := strings.Join(strings.Fields(string(tail)), " ")
	if line == "" {
		return msg
	}
	return msg + ": " + line
}

// withSnippet appends the start of stderr, on one line, to msg.
func withSnippet(msg string, stderr []byte) string {
	snippet := strings.Join(strings.Fields(string(stderr)), " ")
	if len(snippet) > stderrSnippetBytes {
		cut := stderrSnippetBytes
		for cut > 0 && !utf8.RuneStart(snippet[cut]) {
			cut--
		}
		snippet = snippet[:cut] + "…"
	}
	if snippet == "" {
		return msg
	}
	return msg + ": " + snippet
}

// ExecRunner runs argv as a child process, killed if ctx ends first.
func ExecRunner(ctx context.Context, argv []string) (Result, error) {
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	cmd.WaitDelay = 5 * time.Second // don't wait on a grandchild holding the pipes

	err := cmd.Run()
	result := Result{Stdout: stdout.Bytes(), Stderr: stderr.Bytes(), ExitCode: cmd.ProcessState.ExitCode()}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) && result.ExitCode >= 0 {
		return result, nil
	}
	return result, err
}
