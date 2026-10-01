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
	resp, frames := openStream(t, ctx, s.URL, authorizedAs(t, s.Server, mayor))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/events as the Mayor: status %d, want 200", resp.StatusCode)
	}
	nextEvent(t, frames) // the hello: the stream is registered
	s.awaitPresence(t, "governor", true)

	cancel()
	s.awaitPresence(t, "governor", false)
}

func TestAnotherKeysStreamDoesNotMakeTheMayorHere(t *testing.T) {
	s := newGristServer(t, WithIdentity(vectorKeyHex(t, "stranger"), "testnet"))
	governor, _ := s.v.key(t, "governor")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_, frames := openStream(t, ctx, s.URL, authorizedAs(t, s.Server, governor))
	nextEvent(t, frames)
	if _, here := s.presence(t, "governor"); here {
		t.Fatalf("the Governor's own stream made the Mayor here")
	}
}

func TestTwoMayorStreamsAreHereUntilTheLastCloses(t *testing.T) {
	s := newGristServer(t, WithIdentity(vectorKeyHex(t, "stranger"), "testnet"))
	mayor, _ := s.v.key(t, "stranger")

	ctxA, cancelA := context.WithCancel(context.Background())
	defer cancelA()
	ctxB, cancelB := context.WithCancel(context.Background())
	defer cancelB()
	_, framesA := openStream(t, ctxA, s.URL, authorizedAs(t, s.Server, mayor))
	nextEvent(t, framesA)
	_, framesB := openStream(t, ctxB, s.URL, authorizedAs(t, s.Server, mayor))
	nextEvent(t, framesB)

	cancelA()
	time.Sleep(100 * time.Millisecond)
	s.awaitPresence(t, "governor", true)
	cancelB()
	s.awaitPresence(t, "governor", false)
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
