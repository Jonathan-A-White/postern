package licence

import (
	"strings"
	"testing"

	"github.com/Jonathan-A-White/postern/server/internal/chain"
)

// A transaction the provider lists in an address's history but cannot serve
// yet (an unconfirmed one WhatsOnChain answers 404 for) is skipped for this
// walk; anything else that goes wrong reading one fails the check.

func notServed() error {
	return &chain.ProviderError{Provider: "WhatsOnChain", Status: 404}
}

// withHistoryEntry appends an entry for txid at height to address's history.
func withHistoryEntry(f *fakeReader, address, txid string, height int) {
	f.history[address] = append(f.history[address], chain.HistoryEntry{TxHash: txid, Height: height})
}

func TestHeldSkipsAnUnconfirmedTransactionTheProviderCannotServeYet(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	rule := Rule{IssuerKey: pubHex(issuer)}
	reader := newFakeReader()
	reader.add(contractMint(issuer, "postern", addressOf(holder)), addressOf(issuer))
	unserved := fundingTxid(0xa1)
	withHistoryEntry(reader, addressOf(holder), unserved, 0)
	reader.txErr[unserved] = notServed()

	if !mustHeld(t, reader, addressOf(holder), rule) {
		t.Fatal("held = false, want the answer the walk gives without the unserved entry")
	}

	// The same walk without a licence stays false, with no error.
	other := newTestKey(t)
	withHistoryEntry(reader, addressOf(other), unserved, 0)
	if mustHeld(t, reader, addressOf(other), rule) {
		t.Fatal("held = true for a key with no licence, want false")
	}
}

func TestHeldStillFailsOnAConfirmedTransactionTheProviderAnswers404For(t *testing.T) {
	holder := newTestKey(t)
	reader := newFakeReader()
	missing := fundingTxid(0xa2)
	withHistoryEntry(reader, addressOf(holder), missing, 100)
	reader.txErr[missing] = notServed()

	_, err := Held(reader, addressOf(holder), Rule{})
	if err == nil || !strings.Contains(err.Error(), missing) {
		t.Fatalf("Held error = %v, want one naming %s", err, missing)
	}
}

func TestHeldStillFailsOnAnUnconfirmedTransactionTheProviderAnswers500For(t *testing.T) {
	holder := newTestKey(t)
	reader := newFakeReader()
	broken := fundingTxid(0xa3)
	withHistoryEntry(reader, addressOf(holder), broken, 0)
	reader.txErr[broken] = &chain.ProviderError{Provider: "WhatsOnChain", Status: 500}

	_, err := Held(reader, addressOf(holder), Rule{})
	if err == nil || !strings.Contains(err.Error(), broken) {
		t.Fatalf("Held error = %v, want one naming %s", err, broken)
	}
}

func TestHeldStillFailsOnAnUnconfirmedTransactionWithANetworkError(t *testing.T) {
	holder := newTestKey(t)
	reader := newFakeReader()
	lost := fundingTxid(0xa4)
	withHistoryEntry(reader, addressOf(holder), lost, 0)
	reader.txErr[lost] = errTimeout{}

	if _, err := Held(reader, addressOf(holder), Rule{}); err == nil {
		t.Fatal("Held = nil error, want the network failure")
	}
}

type errTimeout struct{}

func (errTimeout) Error() string { return "dial tcp: i/o timeout" }

func TestASkippedTransactionIsNotCachedAndCountsOnceServed(t *testing.T) {
	holder := newTestKey(t)
	mint := contractMint(holder, "spellforge-leaderboard-testnet", addressOf(holder))
	reader := newFakeReader()
	reader.add(mint, addressOf(holder))
	// The mint is unconfirmed and not served yet.
	reader.history[addressOf(holder)][0].Height = 0
	reader.txErr[mint.txid] = notServed()
	cache := NewTxCache(reader, t.TempDir())

	if mustHeld(t, cache, addressOf(holder), Rule{}) {
		t.Fatal("held = true while the mint is not served, want false")
	}

	delete(reader.txErr, mint.txid) // WhatsOnChain serves it now
	if !mustHeld(t, cache, addressOf(holder), Rule{}) {
		t.Fatal("held = false once the mint is served, want true")
	}
	if got := reader.reads[mint.txid]; got != 2 {
		t.Fatalf("reads of the mint = %d, want 2 (the skipped walk was not cached)", got)
	}
	if mustHeld(t, cache, addressOf(holder), Rule{}); reader.reads[mint.txid] != 2 {
		t.Fatalf("reads of the mint = %d, want it cached once served", reader.reads[mint.txid])
	}
}
