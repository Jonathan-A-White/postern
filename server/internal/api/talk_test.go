package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/auth"
	"github.com/Jonathan-A-White/postern/server/internal/blobs"
	"github.com/Jonathan-A-White/postern/server/internal/index"
	"github.com/Jonathan-A-White/postern/server/internal/push"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
	"github.com/btcsuite/btcd/btcec/v2"
)

// The Talk line (docs/protocol.md §20): the Governor's turns are `talk`
// records, and the Mayor's host reads them off GET /api/events with the
// Mayor's key, which configuration vouches for as it does the mill's.

// vectorKeyHex is the public key of the grist vectors' key named name.
func vectorKeyHex(t *testing.T, name string) string {
	t.Helper()
	_, pub := loadGristVectors(t).key(t, name)
	return pub
}

func TestATalkRecordIsAcceptedAndPublishedToTheMayorsStream(t *testing.T) {
	// The vectors' stranger holds no licence at all: here it is the Mayor.
	s := newGristServer(t, WithIdentity(vectorKeyHex(t, "stranger"), "testnet"))
	mayor, _ := s.v.key(t, "stranger")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	resp, frames := openStream(t, ctx, s.URL, authorizedAs(t, s.Server, mayor))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/events as the Mayor's unlicensed key: status %d, want 200", resp.StatusCode)
	}
	if hello := nextEvent(t, frames); hello.name != "hello" {
		t.Fatalf("first event = %q, want hello", hello.name)
	}

	sent := s.deliver(t, "talk", "governor", "stranger")
	got := decodeDirect(t, sent)
	if sent.StatusCode != http.StatusCreated {
		t.Fatalf("delivering a talk record: status %d (%s), want 201", sent.StatusCode, got.Error)
	}

	event := nextEvent(t, frames)
	if event.name != "message" {
		t.Fatalf("event after the talk record = %q, want message", event.name)
	}
	var data struct {
		Seq uint64 `json:"seq"`
	}
	if err := json.Unmarshal([]byte(event.data), &data); err != nil || data.Seq != got.Seq {
		t.Fatalf("message event data = %q, want seq %d", event.data, got.Seq)
	}
}

// A call record (docs/protocol.md §21) is delivered like a turn: the Governor's
// Call me request reaches the Mayor's stream as a message event.
func TestACallRequestIsAcceptedAndPublishedToTheMayorsStream(t *testing.T) {
	s := newGristServer(t, WithIdentity(vectorKeyHex(t, "stranger"), "testnet"))
	mayor, _ := s.v.key(t, "stranger")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	resp, frames := openStream(t, ctx, s.URL, authorizedAs(t, s.Server, mayor))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/events as the Mayor's key: status %d, want 200", resp.StatusCode)
	}
	if hello := nextEvent(t, frames); hello.name != "hello" {
		t.Fatalf("first event = %q, want hello", hello.name)
	}

	sent := s.deliver(t, "call", "governor", "stranger")
	got := decodeDirect(t, sent)
	if sent.StatusCode != http.StatusCreated {
		t.Fatalf("delivering a call record: status %d (%s), want 201", sent.StatusCode, got.Error)
	}

	event := nextEvent(t, frames)
	if event.name != "message" {
		t.Fatalf("event after the call record = %q, want message", event.name)
	}
	var data struct {
		Seq uint64 `json:"seq"`
	}
	if err := json.Unmarshal([]byte(event.data), &data); err != nil || data.Seq != got.Seq {
		t.Fatalf("message event data = %q, want seq %d", event.data, got.Seq)
	}
}

func TestAStrangersKeyIsStillRefusedTheEventStream(t *testing.T) {
	s := newGristServer(t, WithIdentity(vectorKeyHex(t, "stranger"), "testnet"))

	other, err := btcec.NewPrivateKey()
	if err != nil {
		t.Fatalf("btcec.NewPrivateKey: %v", err)
	}
	req, _ := http.NewRequest(http.MethodGet, s.URL+"/api/events", nil)
	req.Header = authorizedAs(t, s.Server, other)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /api/events: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("GET /api/events as an unlicensed stranger: status %d, want 401", resp.StatusCode)
	}

	resp = s.do(t, "cairnPhone", http.MethodGet, "/api/events", "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("GET /api/events as an app's key: status %d, want 403", resp.StatusCode)
	}
}

func TestTheMayorsUnlicensedKeyOpensTheEventStreamAndNothingElse(t *testing.T) {
	s := newGristServer(t, WithIdentity(vectorKeyHex(t, "stranger"), "testnet"))

	for _, route := range []struct{ method, path string }{
		{http.MethodGet, "/api/messages?since=0"},
		{http.MethodPost, "/api/messages"},
		{http.MethodGet, "/api/me"},
		{http.MethodGet, "/api/view"},
		{http.MethodGet, "/api/beads/mw-1"},
		{http.MethodPost, "/api/broadcast"},
		{http.MethodPost, "/api/blobs"},
		{http.MethodGet, "/api/blobs/" + "aa"},
		{http.MethodPost, "/api/push/subscribe"},
	} {
		resp := s.do(t, "stranger", route.method, route.path, "")
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("%s %s as the Mayor's unlicensed key: status %d, want 403", route.method, route.path, resp.StatusCode)
		}
	}
}

func TestAMayorKeyHoldingACockpitLicenceKeepsTheCockpit(t *testing.T) {
	s := newGristServer(t, WithIdentity(vectorKeyHex(t, "governor"), "testnet"))

	s.messagesFor(t, "governor") // fails the test unless 200
	if me := s.me(t, "governor"); me.Mayor == nil {
		t.Fatalf("a Mayor key holding a cockpit licence got %+v from /api/me, want the cockpit's answer", me)
	}
}

func TestAFailingLicenceCheckNeverCutsTheMayorsStreamNorOpensTheCockpit(t *testing.T) {
	mayor, mayorHex := newKey(t)
	store, err := index.Open(t.TempDir())
	if err != nil {
		t.Fatalf("index.Open: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	pushStore, err := push.OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("push.OpenStore: %v", err)
	}
	blobStore, err := blobs.OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("blobs.OpenStore: %v", err)
	}
	// The chain read fails, though the checker would claim a licence.
	checker := &stubChecker{held: true, err: errCheckerFailed}
	server := httptest.NewServer(NewHandler(store, woc.NewClient("http://unused.invalid"), "test-vapid-public-key", pushStore, blobStore, auth.NewNonceStore(time.Minute), checker,
		WithIdentity(mayorHex, "testnet")))
	t.Cleanup(server.Close)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	resp, frames := openStream(t, ctx, server.URL, authorizedAs(t, server, mayor))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/events as the Mayor while the licence check fails: status %d, want 200", resp.StatusCode)
	}
	if hello := nextEvent(t, frames); hello.name != "hello" {
		t.Fatalf("first event = %q, want hello", hello.name)
	}

	req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/messages", nil)
	req.Header = authorizedAs(t, server, mayor)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /api/messages: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("GET /api/messages as the Mayor while the licence check fails: status %d, want 502", resp.StatusCode)
	}
}
