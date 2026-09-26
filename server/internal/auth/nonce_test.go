package auth

import (
	"testing"
	"time"
)

func TestNonceStoreIssueThenConsumeSucceedsOnce(t *testing.T) {
	store := NewNonceStore(time.Minute)

	nonce, err := store.Issue()
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if nonce == "" {
		t.Fatal("Issue returned an empty nonce")
	}

	if !store.Consume(nonce) {
		t.Fatal("Consume returned false for a freshly issued nonce")
	}
	if store.Consume(nonce) {
		t.Fatal("Consume returned true a second time for the same nonce (replay)")
	}
}

func TestNonceStoreIssueReturnsDistinctNonces(t *testing.T) {
	store := NewNonceStore(time.Minute)

	first, err := store.Issue()
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	second, err := store.Issue()
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if first == second {
		t.Fatal("Issue returned the same nonce twice")
	}
}

func TestNonceStoreConsumeRejectsUnknownNonce(t *testing.T) {
	store := NewNonceStore(time.Minute)

	if store.Consume("never-issued") {
		t.Fatal("Consume returned true for a nonce that was never issued")
	}
}

func TestNonceStoreConsumeRejectsExpiredNonce(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	store := NewNonceStore(time.Minute, WithClock(func() time.Time { return now }))

	nonce, err := store.Issue()
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}

	now = now.Add(2 * time.Minute)
	if store.Consume(nonce) {
		t.Fatal("Consume returned true for a nonce past its TTL")
	}
}
