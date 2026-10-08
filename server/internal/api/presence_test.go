package api

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

// The Mayor's presence (docs/protocol.md §20): the Mayor is here while his key
// holds GET /api/events open, which is what `mw talk wait` does.

func (s gristServer) presence(t *testing.T, as string) (int, bool) {
	t.Helper()
	resp := s.do(t, as, http.MethodGet, "/api/presence", "")
	defer resp.Body.Close()
	var body struct {
		Mayor bool `json:"mayor"`
	}
	if resp.StatusCode == http.StatusOK {
		if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
			t.Fatalf("decoding /api/presence: %v", err)
		}
	}
	return resp.StatusCode, body.Mayor
}

// awaitPresence polls until the answer is want: the stream's close reaches the
// handler a moment after the client drops it.
func (s gristServer) awaitPresence(t *testing.T, as string, want bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		status, got := s.presence(t, as)
		if status != http.StatusOK {
			t.Fatalf("GET /api/presence: status %d, want 200", status)
		}
		if got == want {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("GET /api/presence says mayor=%v, want %v", got, want)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestThePresenceSaysTheMayorIsHereWhileHisStreamIsOpen(t *testing.T) {
	s := newGristServer(t, WithIdentity(vectorKeyHex(t, "stranger"), "testnet"))
	mayor, _ := s.v.key(t, "stranger")

	if _, here := s.presence(t, "governor"); here {
		t.Fatalf("the Mayor is here before any stream is open")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	resp, frames := openStream(t, ctx, s.URL, v2As(t, s.Server, mayor, "GET", "/api/events", nil))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/events as the Mayor: status %d, want 200", resp.StatusCode)
	}
	nextEvent(t, frames) // the hello: the stream is registered
	s.awaitPresence(t, "governor", true)

	// The close is not the end of his presence: PRESENCE_GRACE keeps him here
	// (the grace itself is tested against a fake clock below).
	cancel()
	time.Sleep(100 * time.Millisecond)
	s.awaitPresence(t, "governor", true)
}

func TestAnotherKeysStreamDoesNotMakeTheMayorHere(t *testing.T) {
	s := newGristServer(t, WithIdentity(vectorKeyHex(t, "stranger"), "testnet"))
	governor, _ := s.v.key(t, "governor")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_, frames := openStream(t, ctx, s.URL, v2As(t, s.Server, governor, "GET", "/api/events", nil))
	nextEvent(t, frames)
	if _, here := s.presence(t, "governor"); here {
		t.Fatalf("the Governor's own stream made the Mayor here")
	}
}

func TestTwoMayorStreamsAreHereWhileEitherIsOpen(t *testing.T) {
	s := newGristServer(t, WithIdentity(vectorKeyHex(t, "stranger"), "testnet"))
	mayor, _ := s.v.key(t, "stranger")

	ctxA, cancelA := context.WithCancel(context.Background())
	defer cancelA()
	ctxB, cancelB := context.WithCancel(context.Background())
	defer cancelB()
	_, framesA := openStream(t, ctxA, s.URL, v2As(t, s.Server, mayor, "GET", "/api/events", nil))
	nextEvent(t, framesA)
	_, framesB := openStream(t, ctxB, s.URL, v2As(t, s.Server, mayor, "GET", "/api/events", nil))
	nextEvent(t, framesB)

	cancelA()
	time.Sleep(100 * time.Millisecond)
	s.awaitPresence(t, "governor", true)
	cancelB()
	time.Sleep(100 * time.Millisecond)
	s.awaitPresence(t, "governor", true) // within the grace after the last close
}

func TestWithoutAMayorKeyNobodyIsHere(t *testing.T) {
	s := newGristServer(t)
	s.awaitPresence(t, "governor", false)
}

func TestThePresenceIsForTheCockpitAlone(t *testing.T) {
	s := newGristServer(t, WithIdentity(vectorKeyHex(t, "stranger"), "testnet"))
	for _, as := range []string{"stranger", "cairnPhone"} {
		if status, _ := s.presence(t, as); status != http.StatusForbidden {
			t.Fatalf("GET /api/presence as %s: status %d, want 403", as, status)
		}
	}
}

// The grace window, against a clock the test moves (no sleeping).

type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time          { return c.t }
func (c *fakeClock) advance(d time.Duration) { c.t = c.t.Add(d) }

func newTestPresence() (*presence, *fakeClock) {
	c := &fakeClock{t: time.Date(2026, 10, 2, 12, 0, 0, 0, time.UTC)}
	p := newPresence()
	p.now = c.now
	return p, c
}

func TestAStreamClosedTenSecondsAgoStillCountsAsHere(t *testing.T) {
	p, c := newTestPresence()
	p.opened("mayor")()
	c.advance(10 * time.Second)
	if !p.here("mayor") {
		t.Fatalf("a stream closed 10 s ago does not count as here")
	}
}

func TestAStreamClosedJustInsideTheGraceStillCounts(t *testing.T) {
	p, c := newTestPresence()
	p.opened("mayor")()
	c.advance(PRESENCE_GRACE - time.Second)
	if !p.here("mayor") {
		t.Fatalf("a stream closed just inside the grace does not count as here")
	}
}

func TestAStreamClosedOneTwentyOneSecondsAgoDoesNotCount(t *testing.T) {
	p, c := newTestPresence()
	p.opened("mayor")()
	c.advance(121 * time.Second)
	if p.here("mayor") {
		t.Fatalf("a stream closed 121 s ago still counts as here")
	}
}

func TestAReopenedStreamCountsAtOnce(t *testing.T) {
	p, c := newTestPresence()
	p.opened("mayor")()
	c.advance(5 * time.Minute)
	if p.here("mayor") {
		t.Fatalf("the Mayor is here after the grace ran out")
	}
	closeIt := p.opened("mayor")
	if !p.here("mayor") {
		t.Fatalf("a reopened stream does not count at once")
	}
	// Open now, it counts however long it stays open; the grace runs from its close.
	c.advance(5 * time.Minute)
	if !p.here("mayor") {
		t.Fatalf("an open stream stopped counting")
	}
	closeIt()
	c.advance(PRESENCE_GRACE - time.Second)
	if !p.here("mayor") {
		t.Fatalf("the grace did not run from the last close")
	}
}

func TestTheGraceRunsFromTheLastCloseNotTheFirst(t *testing.T) {
	p, c := newTestPresence()
	closeA := p.opened("mayor")
	closeB := p.opened("mayor")
	closeA()
	c.advance(PRESENCE_GRACE + time.Second)
	if !p.here("mayor") {
		t.Fatalf("one stream is still open but the Mayor is not here")
	}
	closeB()
	c.advance(time.Second)
	if !p.here("mayor") {
		t.Fatalf("not here a second after the last close")
	}
}

func TestAnEmptyKeyNeverCountsAsHere(t *testing.T) {
	p, _ := newTestPresence()
	p.opened("")()
	if p.here("") {
		t.Fatalf("an empty key counts as here")
	}
}

func TestPresenceIsPerKeyAndCaseInsensitive(t *testing.T) {
	p, _ := newTestPresence()
	p.opened("ABCD")()
	if !p.here("abcd") {
		t.Fatalf("the key's case matters")
	}
	if p.here("other") {
		t.Fatalf("another key counts as here")
	}
}

func TestClosingAStreamTwiceDoesNothingMore(t *testing.T) {
	p, c := newTestPresence()
	closeA := p.opened("mayor")
	p.opened("mayor")
	closeA()
	closeA()
	c.advance(PRESENCE_GRACE + time.Second)
	if !p.here("mayor") {
		t.Fatalf("a double close ended a stream that is still open")
	}
}
