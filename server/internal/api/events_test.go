package api

import (
	"bufio"
	"context"
	"encoding/hex"
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

// sseFrame is one blank-line-terminated block of an event stream: an event
// (name and data) or a comment.
type sseFrame struct {
	name, data, comment string
}

// readFrames parses frames off an event stream onto a channel until the
// stream ends.
func readFrames(body *bufio.Reader) <-chan sseFrame {
	frames := make(chan sseFrame, 16)
	go func() {
		defer close(frames)
		var frame sseFrame
		for {
			line, err := body.ReadString('\n')
			if err != nil {
				return
			}
			line = strings.TrimSuffix(line, "\n")
			switch {
			case line == "":
				frames <- frame
				frame = sseFrame{}
			case strings.HasPrefix(line, ":"):
				frame.comment = strings.TrimSpace(strings.TrimPrefix(line, ":"))
			case strings.HasPrefix(line, "event: "):
				frame.name = strings.TrimPrefix(line, "event: ")
			case strings.HasPrefix(line, "data: "):
				frame.data = strings.TrimPrefix(line, "data: ")
			}
		}
	}()
	return frames
}

func nextFrame(t *testing.T, frames <-chan sseFrame) sseFrame {
	t.Helper()
	select {
	case frame, ok := <-frames:
		if !ok {
			t.Fatal("event stream ended")
		}
		return frame
	case <-time.After(3 * time.Second):
		t.Fatal("no frame within 3s")
		return sseFrame{}
	}
}

// nextEvent skips pings until the next named event.
func nextEvent(t *testing.T, frames <-chan sseFrame) sseFrame {
	t.Helper()
	for {
		if frame := nextFrame(t, frames); frame.name != "" {
			return frame
		}
	}
}

func openStream(t *testing.T, ctx context.Context, url string, header http.Header) (*http.Response, <-chan sseFrame) {
	t.Helper()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url+"/api/events", nil)
	if err != nil {
		t.Fatalf("building request: %v", err)
	}
	req.Header = header
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /api/events: %v", err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp, readFrames(bufio.NewReader(resp.Body))
}

func TestEventsStreamsHelloThenMessageAndViewEvents(t *testing.T) {
	viewPath := filepath.Join(t.TempDir(), "postern-view.txt")
	if err := os.WriteFile(viewPath, []byte("QkIQ"), 0o644); err != nil {
		t.Fatalf("writing view: %v", err)
	}
	hub := events.NewHub()
	server, store := newServerWithOptions(t,
		WithEvents(hub, time.Hour),
		WithNotifier(notify.Fanout{hub}),
		WithView(view.New(viewPath)),
	)
	store.Append(index.Record{TxID: "tx1", ScriptHex: "00", FirstSeen: time.Now()})
	store.Append(index.Record{TxID: "tx2", ScriptHex: "00", FirstSeen: time.Now()})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	resp, frames := openStream(t, ctx, server.URL, authorizedRequest(t, server))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	for header, want := range map[string]string{
		"Content-Type":      "text/event-stream",
		"Cache-Control":     "no-store",
		"X-Accel-Buffering": "no",
	} {
		if got := resp.Header.Get(header); got != want {
			t.Fatalf("%s = %q, want %q", header, got, want)
		}
	}

	hello := nextEvent(t, frames)
	wantHello := `{"head":2,"view":` + strconvQuote(view.ETagOf([]byte("QkIQ"))) + `}`
	if hello.name != "hello" || hello.data != wantHello {
		t.Fatalf("first event = %+v, want hello %s", hello, wantHello)
	}

	// A direct delivery reaches the stream through the notifier.
	key, pubKeyHex := newKey(t)
	decodeDirect(t, postDirect(t, server, key, `{"scriptHex":"`+hex.EncodeToString(recordScript(1, envelope(pubKeyHex)))+`"}`))
	if msg := nextEvent(t, frames); msg.name != "message" || msg.data != `{"seq":3}` {
		t.Fatalf("event = %+v, want message {\"seq\":3}", msg)
	}

	hub.ViewChanged(`"abc"`)
	if ev := nextEvent(t, frames); ev.name != "view" || ev.data != `{"etag":"\"abc\""}` {
		t.Fatalf("event = %+v, want view {\"etag\":\"\\\"abc\\\"\"}", ev)
	}
}

func strconvQuote(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `\"`) + `"`
}

func TestEventsHelloNamesAnEmptyViewWhenThereIsNone(t *testing.T) {
	server, _ := newServerWithOptions(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_, frames := openStream(t, ctx, server.URL, authorizedRequest(t, server))

	if hello := nextEvent(t, frames); hello.name != "hello" || hello.data != `{"head":0,"view":""}` {
		t.Fatalf("hello = %+v, want head 0 and an empty view", hello)
	}
}

func TestEventsSendsAPingComment(t *testing.T) {
	server, _ := newServerWithOptions(t, WithEvents(events.NewHub(), 20*time.Millisecond))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_, frames := openStream(t, ctx, server.URL, authorizedRequest(t, server))

	nextEvent(t, frames) // hello
	if frame := nextFrame(t, frames); frame.comment != "ping" || frame.name != "" {
		t.Fatalf("frame = %+v, want a \": ping\" comment", frame)
	}
}

func TestEventsDropsTheSubscriberWhenTheClientGoes(t *testing.T) {
	hub := events.NewHub()
	server, _ := newServerWithOptions(t, WithEvents(hub, time.Hour))
	ctx, cancel := context.WithCancel(context.Background())
	_, frames := openStream(t, ctx, server.URL, authorizedRequest(t, server))
	nextEvent(t, frames) // hello
	if hub.Subscribers() != 1 {
		t.Fatalf("Subscribers() = %d with one stream open, want 1", hub.Subscribers())
	}

	cancel()
	deadline := time.Now().Add(3 * time.Second)
	for hub.Subscribers() != 0 {
		if time.Now().After(deadline) {
			t.Fatalf("Subscribers() = %d after the client went, want 0", hub.Subscribers())
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestEventsRequiresAuthorization(t *testing.T) {
	server, _ := newServerWithOptions(t)
	resp, err := http.Get(server.URL + "/api/events")
	if err != nil {
		t.Fatalf("GET /api/events: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}
