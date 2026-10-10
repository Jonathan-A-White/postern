package standby

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/buildinfo"
)

const (
	// probeTimeout is how long one peer's /healthz may take; a peer that
	// overruns it counts as not answering.
	probeTimeout = 3 * time.Second
	// maxProbeBody caps how much of a peer's /healthz answer is read.
	maxProbeBody = 64 << 10
)

// Finder is the relay-only backend's monitor (POSTERN_RELAY_ONLY=1): it asks
// each peer's /healthz which of them is home and so where the send routes go.
// The home is the first peer (in POSTERN_PEERS order) answering 200 with
// "standby": false; with none, the fallback is the first peer answering 200 at
// all, a boost whose standby serves a send locally; with none of those there
// is no target. Safe for concurrent use.
type Finder struct {
	peers  map[string]string
	order  []string
	logf   func(format string, args ...any)
	client *http.Client

	mu      sync.RWMutex
	checked bool
	target  string
	home    string
}

// FinderOption configures a Finder built by NewFinder.
type FinderOption func(*Finder)

// WithFinderLogf overrides log.Printf for changes of target.
func WithFinderLogf(logf func(format string, args ...any)) FinderOption {
	return func(f *Finder) { f.logf = logf }
}

// NewFinder builds a Finder over peers (lower-cased host name to base URL),
// asked in order. Call Check once before serving; Run keeps it fresh.
func NewFinder(peers map[string]string, order []string, opts ...FinderOption) *Finder {
	f := &Finder{peers: peers, order: order, logf: log.Printf, client: &http.Client{
		Timeout:       probeTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
	for _, opt := range opts {
		opt(f)
	}
	return f
}

type probe struct {
	answered bool // 200 with a body
	home     bool // "standby": false
}

func (f *Finder) probe(base string) probe {
	ctx, cancel := context.WithTimeout(context.Background(), probeTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/healthz", nil)
	if err != nil {
		return probe{}
	}
	resp, err := f.client.Do(req)
	if err != nil {
		return probe{}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return probe{}
	}
	var h struct {
		Standby *bool `json:"standby"`
	}
	// A 200 whose body is not the usual JSON still answers; it just is not home.
	json.NewDecoder(io.LimitReader(resp.Body, maxProbeBody)).Decode(&h)
	return probe{answered: true, home: h.Standby != nil && !*h.Standby}
}

// Check asks every peer at once and records the target.
func (f *Finder) Check() {
	if f == nil {
		return
	}
	got := make([]probe, len(f.order))
	var wg sync.WaitGroup
	for i, name := range f.order {
		wg.Add(1)
		go func() {
			defer wg.Done()
			got[i] = f.probe(f.peers[name])
		}()
	}
	wg.Wait()

	target, home := "", ""
	for i, name := range f.order {
		if got[i].home {
			target, home = name, name
			break
		}
	}
	if target == "" {
		for i, name := range f.order {
			if got[i].answered {
				target = name
				break
			}
		}
	}

	f.mu.Lock()
	changed := !f.checked || f.target != target || f.home != home
	f.checked, f.target, f.home = true, target, home
	f.mu.Unlock()
	if changed {
		switch {
		case home != "":
			f.logf("relay-only: target is %s, the home", target)
		case target != "":
			f.logf("relay-only: no peer is home; target is %s, the first that answers", target)
		default:
			f.logf("relay-only: no target: no peer answers /healthz")
		}
	}
}

// Run re-checks every interval until stop is closed.
func (f *Finder) Run(stop <-chan struct{}, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			f.Check()
		}
	}
}

// Target is the name of the peer the send routes go to, "" when none.
func (f *Finder) Target() string {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return f.target
}

// Home is the name of the peer that is home, "" when none is.
func (f *Finder) Home() string {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return f.home
}

type relayOnlyHealth struct {
	OK        bool   `json:"ok"`
	Standby   bool   `json:"standby"`
	RelayOnly bool   `json:"relay_only"`
	Target    string `json:"target"`
	Commit    string `json:"commit,omitempty"`
}

// RelayOnly is the whole handler of a relay-only backend. It never serves a
// request itself: /healthz answers 200 with standby, relay_only and the
// target; a send route is relayed to the target (relay.go) and answered 503
// standby when there is no target or the target cannot be connected to; a
// request already carrying RelayedHeader, and every other /api route, is
// answered 503 standby; anything else is 404.
func RelayOnly(f *Finder, opts ...MiddlewareOption) http.Handler {
	rl := newRelay(opts, log.Printf)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/healthz":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(relayOnlyHealth{OK: true, Standby: true, RelayOnly: true, Target: f.Target(), Commit: buildinfo.Commit()})
		case !strings.HasPrefix(r.URL.Path, "/api/"):
			http.NotFound(w, r)
		case isSendRoute(r) && r.Header.Get(RelayedHeader) == "":
			if target := f.Target(); target != "" && rl.try(w, r, target) {
				return
			}
			writeJSON(w, http.StatusServiceUnavailable, body{Standby: true, Home: f.Home()})
		default:
			writeJSON(w, http.StatusServiceUnavailable, body{Standby: true, Home: f.Home()})
		}
	})
}
