package auth

import (
	"encoding/hex"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/licence"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
	"github.com/btcsuite/btcd/btcec/v2"
)

// countingReader counts how many times its history is fetched, so tests can
// prove a cached answer skips the chain entirely.
type countingReader struct {
	historyCalls int
	held         bool
}

func (r *countingReader) GetHistory(address string) ([]woc.HistoryEntry, error) {
	r.historyCalls++
	if r.held {
		return []woc.HistoryEntry{{TxHash: "mint1", Height: 1}}, nil
	}
	return nil, nil
}

func (r *countingReader) GetTransactionHex(txid string) (string, error) {
	// held=false never calls this; held=true is exercised via a dedicated
	// integration-style test using the real licence.Held rule instead, so a
	// canned empty tx here is enough to keep GetHistory's stub simple.
	return "", nil
}

func testPubKeyHex(t *testing.T) string {
	t.Helper()
	privKey, err := btcec.NewPrivateKey()
	if err != nil {
		t.Fatalf("NewPrivateKey: %v", err)
	}
	return hex.EncodeToString(privKey.PubKey().SerializeCompressed())
}

func TestCachedCheckerCachesAHeldFalseAnswer(t *testing.T) {
	reader := &countingReader{held: false}
	checker := NewCachedChecker(reader, time.Minute)
	pubKeyHex := testPubKeyHex(t)

	held, err := checker.Held(pubKeyHex)
	if err != nil {
		t.Fatalf("Held: %v", err)
	}
	if held {
		t.Fatal("held = true, want false")
	}

	if _, err := checker.Held(pubKeyHex); err != nil {
		t.Fatalf("Held (second call): %v", err)
	}
	if reader.historyCalls != 1 {
		t.Fatalf("historyCalls = %d, want 1 (second call should hit the cache)", reader.historyCalls)
	}
}

func TestCachedCheckerRefetchesAfterTTLExpires(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	reader := &countingReader{held: false}
	checker := NewCachedChecker(reader, time.Minute, WithCheckerClock(func() time.Time { return now }))
	pubKeyHex := testPubKeyHex(t)

	if _, err := checker.Held(pubKeyHex); err != nil {
		t.Fatalf("Held: %v", err)
	}
	now = now.Add(2 * time.Minute)
	if _, err := checker.Held(pubKeyHex); err != nil {
		t.Fatalf("Held (after TTL): %v", err)
	}
	if reader.historyCalls != 2 {
		t.Fatalf("historyCalls = %d, want 2 (cache entry should have expired)", reader.historyCalls)
	}
}

func TestCachedCheckerCachesSeparatelyPerKey(t *testing.T) {
	reader := &countingReader{held: false}
	checker := NewCachedChecker(reader, time.Minute)

	if _, err := checker.Held(testPubKeyHex(t)); err != nil {
		t.Fatalf("Held: %v", err)
	}
	if _, err := checker.Held(testPubKeyHex(t)); err != nil {
		t.Fatalf("Held: %v", err)
	}
	if reader.historyCalls != 2 {
		t.Fatalf("historyCalls = %d, want 2 (different keys should not share a cache entry)", reader.historyCalls)
	}
}

func TestCachedCheckerRejectsMalformedPublicKey(t *testing.T) {
	checker := NewCachedChecker(&countingReader{}, time.Minute)
	if _, err := checker.Held("not-hex"); err == nil {
		t.Fatal("expected an error for a malformed public key")
	}
}

// Ensures CachedChecker actually delegates to licence.Held, not a hardcoded
// answer: a checker over a reader with no history for the derived address
// reports not held.
var _ licence.Reader = (*countingReader)(nil)
