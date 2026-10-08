package api

import (
	"bytes"
	"context"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/auth"
	"github.com/Jonathan-A-White/postern/server/internal/blobs"
	"github.com/Jonathan-A-White/postern/server/internal/index"
	"github.com/Jonathan-A-White/postern/server/internal/licence"
	"github.com/Jonathan-A-White/postern/server/internal/push"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
	"github.com/btcsuite/btcd/btcec/v2"
)

// A backend swap must not leave a request waiting on a licence walk over
// WhatsOnChain: after a restart a key's earlier answer is served at once, and
// the Mayor's key never waits on one for the routes it is let in by
// configuration (mw-gq6.215).

// blockedChain is a chain reader whose every read parks until release is
// closed, counting the history reads that start.
type blockedChain struct {
	release chan struct{}
	walks   atomic.Int32
}

func newBlockedChain() *blockedChain { return &blockedChain{release: make(chan struct{})} }

func (b *blockedChain) GetHistory(string) ([]woc.HistoryEntry, error) {
	b.walks.Add(1)
	<-b.release
	return nil, nil
}

func (b *blockedChain) GetTransactionHex(string) (string, error) {
	<-b.release
	return "", nil
}

// blockedChecker is a LicenceChecker that never answers until release is closed.
type blockedChecker struct{ release chan struct{} }

func (b blockedChecker) Held(string) (bool, error) {
	<-b.release
	return true, nil
}

// bareServer is a backend over checker with the given options and nothing else.
func bareServer(t *testing.T, checker auth.LicenceChecker, opts ...Option) *httptest.Server {
	t.Helper()
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
	server := httptest.NewServer(NewHandler(store, woc.NewClient("http://unused.invalid"), "test-vapid-public-key", pushStore, blobStore, auth.NewNonceStore(time.Minute), checker, opts...))
	t.Cleanup(server.Close)
	return server
}

// getWithin issues GET path as key and fails the test unless a response with
// want arrives within a second.
func getWithin(t *testing.T, server *httptest.Server, key *btcec.PrivateKey, path string, want int) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	signRequest(t, server, key, req)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET %s: no answer within 1 s: %v", path, err)
	}
	resp.Body.Close()
	if resp.StatusCode != want {
		t.Fatalf("GET %s: status %d, want %d", path, resp.StatusCode, want)
	}
}

func TestARestartedBackendServesAKeyWithAnEarlierAnswerWhileTheChainIsBlocked(t *testing.T) {
	const collection = "postern"
	issuer, _ := btcec.PrivKeyFromBytes(bytes.Repeat([]byte{0x77}, 32))
	holder, _ := btcec.PrivKeyFromBytes(bytes.Repeat([]byte{0x55}, 32))
	issuerHex := hex.EncodeToString(issuer.PubKey().SerializeCompressed())
	issuerAddress, _ := licence.AddressForPublicKey(issuerHex)
	holderAddress, _ := licence.AddressForPublicKey(hex.EncodeToString(holder.PubKey().SerializeCompressed()))
	chain := &chainFake{history: map[string][]woc.HistoryEntry{}, txs: map[string]string{}}
	chain.put(fundingTx(issuer, 0xf1))
	chain.add(issuerAddress, gatedMint(issuer, collection, holderAddress))
	rule := licence.Rule{Collections: []string{collection}, IssuerKey: issuerHex}
	answers := filepath.Join(t.TempDir(), "licence-answers.json")

	// The backend's first life learns the licence over a working chain.
	first := bareServer(t, auth.NewCachedChecker(chain, time.Minute, auth.WithRule(rule), auth.WithPersistence(answers)))
	getWithin(t, first, holder, "/api/messages", http.StatusOK)

	// After the swap the chain answers nothing, and the key is let in at once.
	blocked := newBlockedChain()
	defer close(blocked.release)
	second := bareServer(t, auth.NewCachedChecker(blocked, time.Minute, auth.WithRule(rule), auth.WithPersistence(answers)))
	getWithin(t, second, holder, "/api/messages", http.StatusOK)
	waitUntil(t, func() bool { return blocked.walks.Load() >= 1 }) // and the refresh went to the chain
}

func TestTheMayorsKeyIsLetInWithoutWaitingOnTheLicenceReader(t *testing.T) {
	mayor, mayorHex := newKey(t)

	stuck := blockedChecker{release: make(chan struct{})}
	defer close(stuck.release)
	getEventsWithin(t, bareServer(t, stuck, WithIdentity(mayorHex, "testnet")), mayor)

	chain := newBlockedChain()
	defer close(chain.release)
	getEventsWithin(t, bareServer(t, auth.NewCachedChecker(chain, time.Minute), WithIdentity(mayorHex, "testnet")), mayor)
	waitUntil(t, func() bool { return chain.walks.Load() >= 1 }) // the walk it warmed in the background
}

func getEventsWithin(t *testing.T, server *httptest.Server, key *btcec.PrivateKey) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/api/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	signRequest(t, server, key, req)
	resp, err := http.DefaultClient.Do(req) // headers arrive once the stream opens
	if err != nil {
		t.Fatalf("GET /api/events as the Mayor: no answer within 1 s: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/events as the Mayor: status %d, want 200", resp.StatusCode)
	}
}

func TestAMayorRouteThatNeedsALicenceStillWaitsForTheWalk(t *testing.T) {
	mayor, mayorHex := newKey(t)
	chain := newBlockedChain()
	server := bareServer(t, auth.NewCachedChecker(chain, time.Minute), WithIdentity(mayorHex, "testnet"))

	done := make(chan int, 1)
	go func() {
		req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/messages", nil)
		signRequest(t, server, mayor, req)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			done <- 0
			return
		}
		resp.Body.Close()
		done <- resp.StatusCode
	}()
	select {
	case status := <-done:
		t.Fatalf("GET /api/messages answered %d before the licence walk finished", status)
	case <-time.After(200 * time.Millisecond):
	}
	close(chain.release)
	if status := <-done; status != http.StatusForbidden {
		t.Fatalf("GET /api/messages once the walk found no licence: %d, want 403 (the Mayor's key, but no cockpit)", status)
	}
}

func waitUntil(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not reached in time")
		}
		time.Sleep(time.Millisecond)
	}
}
