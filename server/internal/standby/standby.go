// Package standby is postern's standby mode. Both hosts run the backend all
// the time and nginx fails over on 503 (story nginx-two, millwright); the one
// that is not home must not act as a second backend. POSTERN_HOME_CMD is a
// command (exit 0 = this host is home, e.g. `mw home --check`) checked at
// start and every DefaultInterval. In standby every /api route answers 503
// {"standby": true, "home": ...} before any work, except the routes a send
// needs, so the Governor can still send a move-home message when the home is
// dead; /healthz answers 200 with standby true; and push notifications are
// not sent. The chain poll, the index and the on-message hook run as ever.
// A send route is passed on to the home's backend (POSTERN_PEERS) so the
// home's index holds the Governor's sends; it is served here only when the
// home cannot be reached (relay.go).
package standby

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/buildinfo"
	"github.com/Jonathan-A-White/postern/server/internal/index"
	"github.com/Jonathan-A-White/postern/server/internal/notify"
)

const (
	// DefaultInterval is how often the home command is re-run.
	DefaultInterval = 30 * time.Second
	// DefaultTimeout is how long one run of the home command may take; a
	// command that overruns it counts as "not home".
	DefaultTimeout = 10 * time.Second
	// maxHomeLen caps how much of the command's output is kept and served.
	maxHomeLen = 256
)

// Runner runs the home command once, returning what it printed (stdout) and
// a non-nil error for any exit other than 0.
type Runner func(ctx context.Context) ([]byte, error)

// Monitor tracks whether this host is home. A nil *Monitor (POSTERN_HOME_CMD
// unset) is never standby. Safe for concurrent use.
type Monitor struct {
	run     Runner
	timeout time.Duration
	logf    func(format string, args ...any)

	mu      sync.RWMutex
	checked bool
	standby bool
	home    string
}

// Option configures a Monitor built by New.
type Option func(*Monitor)

// WithRunner overrides running the command through sh -c.
func WithRunner(run Runner) Option { return func(m *Monitor) { m.run = run } }

// WithLogf overrides log.Printf for state changes.
func WithLogf(logf func(format string, args ...any)) Option {
	return func(m *Monitor) { m.logf = logf }
}

// New builds a Monitor for command, run through `sh -c`. Call Check once
// before serving; Run keeps it fresh.
func New(command string, opts ...Option) *Monitor {
	m := &Monitor{timeout: DefaultTimeout, logf: log.Printf}
	m.run = func(ctx context.Context) ([]byte, error) {
		cmd := exec.CommandContext(ctx, "sh", "-c", command)
		cmd.WaitDelay = time.Second // don't wait on a grandchild holding the pipe
		return cmd.Output()
	}
	for _, opt := range opts {
		opt(m)
	}
	return m
}

// Check runs the home command and records the answer: exit 0 is home,
// anything else (a failing exit, a command not found, a timeout) is standby,
// with whatever the command printed kept as the home to name.
func (m *Monitor) Check() {
	if m == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), m.timeout)
	defer cancel()
	out, err := m.run(ctx)

	standby := err != nil
	home := strings.TrimSpace(string(out))
	if len(home) > maxHomeLen {
		home = home[:maxHomeLen]
	}
	if standby {
		m.logf("standby: home command says this host is not home: %v; printed %q", err, home)
	}

	m.mu.Lock()
	changed := m.checked && m.standby != standby
	m.checked, m.standby, m.home = true, standby, home
	m.mu.Unlock()
	if changed && !standby {
		m.logf("standby: this host is home now")
	}
}

// Run re-checks every interval until stop is closed.
func (m *Monitor) Run(stop <-chan struct{}, interval time.Duration) {
	if m == nil {
		return
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			m.Check()
		}
	}
}

// Standby reports whether this host is not home.
func (m *Monitor) Standby() bool {
	if m == nil {
		return false
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.standby
}

// Home is what the home command last printed while this host was in standby,
// "" if nothing (or at home).
func (m *Monitor) Home() string {
	if m == nil {
		return ""
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	if !m.standby {
		return ""
	}
	return m.home
}

// Gate wraps n so it is told about nothing while m is in standby.
func Gate(m *Monitor, n notify.Notifier) notify.Notifier {
	return notify.Func(func(rec index.Record) {
		if !m.Standby() {
			n.RecordIndexed(rec)
		}
	})
}

// isSendRoute reports whether r is one of the routes the app's send needs (src/services/send.ts and
// deliver.ts): a challenge to sign, the direct delivery of a message (which
// needs the Mayor's key from /api/me), and the UTXO and broadcast proxy for
// the funded fallback.
func isSendRoute(r *http.Request) bool {
	p := r.URL.Path
	switch r.Method {
	case http.MethodGet:
		return p == "/api/challenge" || p == "/api/me" || strings.HasPrefix(p, "/api/utxos/")
	case http.MethodPost:
		return p == "/api/messages" || p == "/api/broadcast"
	}
	return false
}

type body struct {
	OK      bool   `json:"ok,omitempty"`
	Standby bool   `json:"standby"`
	Home    string `json:"home,omitempty"`
	Commit  string `json:"commit,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, b body) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(b)
}

// Middleware wraps next so that, while m is in standby, /healthz answers 200
// with standby true and every /api route but the send routes answers 503
// before next does any work. A send route is first relayed to the home's
// backend when WithPeers names one (relay.go) and served by next only when
// that cannot be done. At home, or with m nil, it is next untouched.
func Middleware(m *Monitor, next http.Handler, opts ...MiddlewareOption) http.Handler {
	if m == nil {
		return next
	}
	rl := newRelay(opts, log.Printf)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if m.Standby() {
			switch {
			case r.URL.Path == "/healthz":
				writeJSON(w, http.StatusOK, body{OK: true, Standby: true, Home: m.Home(), Commit: buildinfo.Commit()})
				return
			case strings.HasPrefix(r.URL.Path, "/api/") && !isSendRoute(r):
				writeJSON(w, http.StatusServiceUnavailable, body{Standby: true, Home: m.Home()})
				return
			case isSendRoute(r) && rl.try(w, r, m.Home()):
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
