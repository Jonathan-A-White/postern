package licence

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// A transaction never changes once it is on chain, so a walk after a restart
// reads from disk whatever an earlier walk already fetched (mw-gq6.215).

func TestAWalkAfterARestartRefetchesNoTransactionAlreadyOnDisk(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	mint := contractMint(issuer, "postern", addressOf(holder))
	chain := newFakeReader()
	chain.add(mint, addressOf(issuer))
	rule := Rule{IssuerKey: pubHex(issuer)}
	dir := filepath.Join(t.TempDir(), "txhex")

	first := NewTxCache(chain, dir)
	if !mustHeld(t, first, addressOf(holder), rule) {
		t.Fatal("held = false before the restart, want true")
	}
	fetched := chain.totalReads()
	if fetched == 0 {
		t.Fatal("the first walk read no transaction, so this test proves nothing")
	}

	restarted := NewTxCache(chain, dir) // a new process: nothing in memory
	if !mustHeld(t, restarted, addressOf(holder), rule) {
		t.Fatal("held = false after the restart, want true")
	}
	if got := chain.totalReads(); got != fetched {
		t.Fatalf("the walk after the restart fetched %d transactions, want none beyond the first walk's %d", got-fetched, fetched)
	}
}

func TestAWalkAfterARestartFetchesOnlyTheHistoryItHasNotSeen(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	chain := newFakeReader()
	chain.add(contractMint(issuer, "postern", addressOf(holder)), addressOf(issuer))
	dir := t.TempDir()
	rule := Rule{IssuerKey: pubHex(issuer)}
	mustHeld(t, NewTxCache(chain, dir), addressOf(holder), rule)
	seen := chain.totalReads()

	other := newTestKey(t)
	later := contractMintFundedBy(issuer, "postern", addressOf(other), 0xf2)
	chain.add(later, addressOf(issuer))
	if !mustHeld(t, NewTxCache(chain, dir), addressOf(other), rule) {
		t.Fatal("held = false for a mint made after the restart, want true")
	}
	if got := chain.reads[later.txid]; got != 1 {
		t.Fatalf("the new mint was read %d times, want once", got)
	}
	if got := chain.totalReads() - seen; got > 1+len(later.prevs) {
		t.Fatalf("the second walk made %d reads, want only the new transaction and what it spends", got)
	}
}

func TestAFailedReadIsNotRememberedAndACorruptFileIsRefetched(t *testing.T) {
	chain := newFakeReader()
	txid := fundingTxid(0x31)
	chain.txs[txid] = "0100"
	chain.txErr[txid] = errors.New("WhatsOnChain said 503")
	dir := t.TempDir()
	cache := NewTxCache(chain, dir)

	if _, err := cache.GetTransactionHex(txid); err == nil {
		t.Fatal("GetTransactionHex = nil error, want the read failure")
	}
	delete(chain.txErr, txid)
	if got, err := cache.GetTransactionHex(txid); err != nil || got != "0100" {
		t.Fatalf("after the chain recovers: %q, %v; want the hex", got, err)
	}

	if err := os.WriteFile(filepath.Join(dir, txid+".hex"), []byte("not hex at all"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got, err := NewTxCache(chain, dir).GetTransactionHex(txid); err != nil || got != "0100" {
		t.Fatalf("with a corrupt file on disk: %q, %v; want it refetched", got, err)
	}
}

func TestATxidThatIsNotAHashNeverNamesAFile(t *testing.T) {
	chain := newFakeReader()
	chain.txs["../escape"] = "0100"
	dir := filepath.Join(t.TempDir(), "txhex")
	cache := NewTxCache(chain, dir)

	if got, err := cache.GetTransactionHex("../escape"); err != nil || got != "0100" {
		t.Fatalf("GetTransactionHex = %q, %v; want the chain's answer passed through", got, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "..", "escape.hex")); err == nil {
		t.Fatal("a file was written outside the cache directory")
	}
}
