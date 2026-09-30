package standby

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptrace"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	// RelayedHeader marks a request a standby has passed on, so a host that
	// also thinks it is in standby serves it instead of passing it back.
	RelayedHeader = "X-Postern-Relayed"
	// relayDialTimeout is how long connecting to the home may take before
	// the home counts as unreachable and the send is served here.
	relayDialTimeout = 3 * time.Second
	// relayResponseTimeout is how long the home may take to answer once it
	// has the request.
	relayResponseTimeout = 60 * time.Second
	// maxRelayBody caps the request body a relay keeps to replay locally
	// (a direct message is capped at 256 KiB by the api).
	maxRelayBody = 1 << 20
)

// MiddlewareOption configures Middleware.
type MiddlewareOption func(*relay)

// WithPeers names each host's backend: lower-cased host name to base URL
// (scheme://host[:port]). While in standby, a send route is relayed to the
// backend of the host the monitor names as home.
func WithPeers(peers map[string]string) MiddlewareOption {
	return func(r *relay) { r.peers = peers }
}

// WithRelayLogf overrides log.Printf for relay lines.
func WithRelayLogf(logf func(format string, args ...any)) MiddlewareOption {
	return func(r *relay) { r.logf = logf }
}

// relay passes a standby's send routes on to the home's backend.
type relay struct {
	peers  map[string]string
	logf   func(format string, args ...any)
	client *http.Client

	mu     sync.Mutex
	warned map[string]bool
}

func newRelay(opts []MiddlewareOption, defaultLogf func(string, ...any)) *relay {
	r := &relay{logf: defaultLogf, warned: map[string]bool{}}
	for _, opt := range opts {
		opt(r)
	}
	r.client = &http.Client{
		// A redirect is the home's answer like any other.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		Transport: &http.Transport{
			DialContext:           (&net.Dialer{Timeout: relayDialTimeout}).DialContext,
			ResponseHeaderTimeout: relayResponseTimeout,
			DisableKeepAlives:     true,
			DisableCompression:    true,
		},
	}
	if len(r.peers) == 0 {
		r.logf("standby: POSTERN_PEERS is empty: while this host is not home it serves the send routes itself")
	}
	return r
}

// peerFor is the home's backend URL, "" when POSTERN_PEERS names none for
// it (logged once per home name).
func (rl *relay) peerFor(home string) string {
	if len(rl.peers) == 0 {
		return ""
	}
	if u := rl.peers[strings.ToLower(home)]; u != "" {
		return u
	}
	rl.mu.Lock()
	first := !rl.warned[home]
	rl.warned[home] = true
	rl.mu.Unlock()
	if first {
		rl.logf("standby: POSTERN_PEERS names no backend for home %q: sends are served here", home)
	}
	return ""
}

// try passes r on to the home's backend and writes its answer, reporting
// true. It reports false, having written nothing and left r.Body readable
// again, when the send should be served here: no backend is known for the
// home, the request was already relayed, or the connection to the home could
// not be made at all. Once the home has the connection, a failure is a 502
// and never a fallback, so a POST never runs twice.
func (rl *relay) try(w http.ResponseWriter, r *http.Request, home string) bool {
	if r.Header.Get(RelayedHeader) != "" {
		return false
	}
	base := rl.peerFor(home)
	if base == "" {
		return false
	}
	payload, err := io.ReadAll(io.LimitReader(r.Body, maxRelayBody+1))
	if err != nil || len(payload) > maxRelayBody {
		// Too big or broken to replay: let the local handler see it as it would.
		r.Body = io.NopCloser(io.MultiReader(bytes.NewReader(payload), r.Body))
		return false
	}
	r.Body = io.NopCloser(bytes.NewReader(payload))

	target := base + r.URL.RequestURI()
	var connected atomic.Bool
	ctx := httptrace.WithClientTrace(r.Context(), &httptrace.ClientTrace{
		GotConn: func(httptrace.GotConnInfo) { connected.Store(true) },
	})
	out, err := http.NewRequestWithContext(ctx, r.Method, target, bytes.NewReader(payload))
	if err != nil {
		rl.logf("standby: relay of %s %s to home %q failed: %v; serving it here", r.Method, r.URL.Path, home, err)
		return false
	}
	out.Host = r.Host
	out.Header = r.Header.Clone()
	if out.Header.Get("User-Agent") == "" {
		out.Header.Set("User-Agent", "") // the client would add its own
	}
	out.Header.Set(RelayedHeader, "1")

	resp, err := rl.client.Do(out)
	if err != nil {
		if !connected.Load() && !errors.Is(err, context.Canceled) {
			rl.logf("standby: relay of %s %s to home %q failed, could not connect: %v; serving it here", r.Method, r.URL.Path, home, err)
			r.Body = io.NopCloser(bytes.NewReader(payload))
			return false
		}
		rl.logf("standby: relay of %s %s to home %q failed after connecting: %v", r.Method, r.URL.Path, home, err)
		writeJSON(w, http.StatusBadGateway, body{Standby: true, Home: home})
		return true
	}
	defer resp.Body.Close()
	for name, values := range resp.Header {
		w.Header()[name] = values
	}
	w.WriteHeader(resp.StatusCode)
	if _, err := io.Copy(w, resp.Body); err != nil {
		rl.logf("standby: relay of %s %s to home %q: reading its answer: %v", r.Method, r.URL.Path, home, err)
	}
	return true
}
