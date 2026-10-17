package api

import (
	"bufio"
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/events"
	"github.com/Jonathan-A-White/postern/server/internal/index"
	"github.com/Jonathan-A-White/postern/server/internal/notify"
	"github.com/Jonathan-A-White/postern/server/internal/view"
)

// newGristStreamServer is newGristServer with an events hub fed by direct
// delivery and a view file written, so a stream has everything to carry.
func newGristStreamServer(t *testing.T) (gristServer, *events.Hub) {
	t.Helper()
	viewPath := filepath.Join(t.TempDir(), "postern-view.txt")
	if err := os.WriteFile(viewPath, []byte("QkIQ"), 0o644); err != nil {
		t.Fatalf("writing view: %v", err)
	}
	hub := events.NewHub()
	s := newGristServer(t, WithEvents(hub, time.Hour), WithNotifier(notify.Fanout{hub}), WithView(view.New(viewPath)))
	return s, hub
}

// openStreamAs opens GET /api/events as the vectors' key named as.
func (s gristServer) openStreamAs(t *testing.T, ctx context.Context, as string) (*http.Response, <-chan sseFrame) {
	t.Helper()
	priv, _ := s.v.key(t, as)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.URL+"/api/events", nil)
	if err != nil {
		t.Fatalf("building request: %v", err)
	}
	signRequest(t, s.Server, priv, req)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /api/events as %s: %v", as, err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp, readFrames(bufio.NewReader(resp.Body))
}

func (s gristServer) mustDeliver(t *testing.T, class, from, to string) {
	t.Helper()
	resp := s.deliver(t, class, from, to)
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("delivering %s %s→%s: status %d", class, from, to, resp.StatusCode)
	}
}

func TestAnAppKeyOpensTheEventStreamAndMeListsEvents(t *testing.T) {
	s, _ := newGristStreamServer(t)
	s.mustDeliver(t, "message", "governor", "mill")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	resp, frames := s.openStreamAs(t, ctx, "cairnPhone")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if got := resp.Header.Get("Content-Type"); got != "text/event-stream" {
		t.Fatalf("Content-Type = %q, want text/event-stream", got)
	}
	// The head is what an app key's GET /api/messages already answers as
	// next; the view's ETag is the factory's, so it is left out.
	if hello := nextEvent(t, frames); hello.name != "hello" || hello.data != `{"head":1}` {
		t.Fatalf("first event = %+v, want hello {\"head\":1} with no view", hello)
	}

	if me := s.me(t, "cairnPhone"); !contains(me.Features, "events") || !contains(me.Features, "grist") {
		t.Fatalf("app /api/me features = %v, want events and grist", me.Features)
	}
}

func TestAnAppKeysStreamCarriesOnlyTheRecordsItMayPage(t *testing.T) {
	s, hub := newGristStreamServer(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_, frames := s.openStreamAs(t, ctx, "cairnPhone")
	nextEvent(t, frames) // hello

	// None of these is the app's to read: other keys' records, a seq the
	// index does not hold, the factory's view and a key's Ideas only mode.
	s.mustDeliver(t, "message", "governor", "mill") // seq 1
	s.mustDeliver(t, "grist", "mill", "governor")   // seq 2
	hub.RecordIndexed(index.Record{Seq: 999})
	hub.ViewChanged(`"abc"`)
	hub.IdeasOnlyChanged("02"+strings.Repeat("ab", 32), true, 1790003600)

	s.mustDeliver(t, "grist", "mill", "cairnPhone") // seq 3: the answer to its grist
	if ev := nextEvent(t, frames); ev.name != "message" || ev.data != `{"seq":3}` {
		t.Fatalf("event = %+v, want message {\"seq\":3}, the first record it may page", ev)
	}
	s.mustDeliver(t, "grist", "mill", "mill")       // seq 4: the mill to itself
	s.mustDeliver(t, "grist", "cairnPhone", "mill") // seq 5: its own grist
	if ev := nextEvent(t, frames); ev.name != "message" || ev.data != `{"seq":5}` {
		t.Fatalf("event = %+v, want message {\"seq\":5}, its own grist", ev)
	}

	records, _ := s.messagesFor(t, "cairnPhone")
	if len(records) != 2 || records[0].Seq != 3 || records[1].Seq != 5 {
		t.Fatalf("cairnPhone pages %+v, want seqs 3 and 5: the stream named exactly those", records)
	}
}

func TestACockpitStreamStillCarriesEverythingBesideAnAppStream(t *testing.T) {
	s, hub := newGristStreamServer(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_, app := s.openStreamAs(t, ctx, "cairnPhone")
	_, cockpit := s.openStreamAs(t, ctx, "governor")
	nextEvent(t, app)
	if hello := nextEvent(t, cockpit); hello.name != "hello" || hello.data != `{"head":0,"view":`+strconvQuote(view.ETagOf([]byte("QkIQ")))+`}` {
		t.Fatalf("cockpit hello = %+v, want the head and the view's ETag", hello)
	}

	s.mustDeliver(t, "message", "governor", "mill")
	hub.ViewChanged(`"abc"`)
	s.mustDeliver(t, "grist", "mill", "cairnPhone")
	for _, want := range []sseFrame{
		{name: "message", data: `{"seq":1}`},
		{name: "view", data: `{"etag":"\"abc\""}`},
		{name: "message", data: `{"seq":2}`},
	} {
		if ev := nextEvent(t, cockpit); ev.name != want.name || ev.data != want.data {
			t.Fatalf("cockpit event = %+v, want %+v", ev, want)
		}
	}
	if ev := nextEvent(t, app); ev.name != "message" || ev.data != `{"seq":2}` {
		t.Fatalf("app event = %+v, want message {\"seq\":2}", ev)
	}
}

func TestTheMillKeyOpensTheEventStreamAndMeListsEvents(t *testing.T) {
	s, _ := newGristStreamServer(t)
	s.mustDeliver(t, "grist", "cairnPhone", "mill")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	resp, frames := s.openStreamAs(t, ctx, "mill")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if got := resp.Header.Get("Content-Type"); got != "text/event-stream" {
		t.Fatalf("Content-Type = %q, want text/event-stream", got)
	}
	// The head only, as an app key's: never the view's ETag.
	if hello := nextEvent(t, frames); hello.name != "hello" || hello.data != `{"head":1}` {
		t.Fatalf("first event = %+v, want hello {\"head\":1} with no view", hello)
	}
	if me := s.me(t, "mill"); !contains(me.Features, "events") || !contains(me.Features, "grist") {
		t.Fatalf("mill /api/me features = %v, want grist and events", me.Features)
	}
}

// The mill's stream carries a grist record naming the mill as to or from, and
// nothing else: it hears a grist sent to it (seq 3) and a grist it sent (seq
// 5); it does not hear a direct message to the mill (seq 1: it may page it,
// but it is not grist), a direct message to the Governor (seq 2), a grist
// between two other keys (seq 4),
// a record the index does not hold, the view or an Ideas only change.
func TestTheMillKeysStreamHearsOnlyGristNamingTheMill(t *testing.T) {
	s, hub := newGristStreamServer(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_, frames := s.openStreamAs(t, ctx, "mill")
	nextEvent(t, frames) // hello

	s.mustDeliver(t, "message", "governor", "mill")     // seq 1: a direct message to the mill
	s.mustDeliver(t, "message", "governor", "governor") // seq 2: a direct message to the Governor
	hub.RecordIndexed(index.Record{Seq: 999})
	hub.ViewChanged(`"abc"`)
	hub.IdeasOnlyChanged("02"+strings.Repeat("ab", 32), true, 1790003600)

	s.mustDeliver(t, "grist", "cairnPhone", "mill") // seq 3: a grist to the mill
	if ev := nextEvent(t, frames); ev.name != "message" || ev.data != `{"seq":3}` {
		t.Fatalf("event = %+v, want message {\"seq\":3}, the first grist naming the mill", ev)
	}
	s.mustDeliver(t, "grist", "governor", "cairnPhone") // seq 4: two other keys
	s.mustDeliver(t, "grist", "mill", "cairnPhone")     // seq 5: the mill's answer
	if ev := nextEvent(t, frames); ev.name != "message" || ev.data != `{"seq":5}` {
		t.Fatalf("event = %+v, want message {\"seq\":5}, a grist the mill sent", ev)
	}
}

func TestTheMillKeyIsRefusedEveryRouteButTheOnesItWasAdmittedTo(t *testing.T) {
	s, _ := newGristStreamServer(t)
	admitted := map[string]bool{
		"GET /api/messages":        true,
		"POST /api/messages":       true,
		"GET /api/me":              true,
		"GET /api/events":          true, // mw-46z0my.14
		"GET /api/prompts":         true,
		"GET /api/prompts/{name}":  true,
		"GET /api/blobs/{hash}":    true,
		"DELETE /api/blobs/{hash}": true,
	}
	// A request the gate refuses never reaches its handler, so a path with
	// placeholders filled in and no body is enough to read the gate.
	for _, pattern := range Routes() {
		if admitted[pattern] {
			continue
		}
		method, path, _ := strings.Cut(pattern, " ")
		path = strings.NewReplacer("{name}", "x", "{hash}", strings.Repeat("a", 64), "{pubkey}", "02"+strings.Repeat("ab", 32), "{id}", "mw-1", "{address}", "mxyz").Replace(path)
		resp := s.do(t, "mill", method, path, "")
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Errorf("%s as mill: status %d, want 403: no route but the events stream was widened", pattern, resp.StatusCode)
		}
	}
}
