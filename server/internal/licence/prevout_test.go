package licence

import (
	"errors"
	"testing"

	"github.com/btcsuite/btcd/btcec/v2"
)

// A scriptSig that merely pushes the issuer's key proves nothing: the
// network checks it against the output it spends, and only an output P2PKH
// to the issuer's key makes it a signature by the issuer. These tests forge
// '<junk> <issuer key>' over outputs that never asked for one (mw-gq6.175).

// opaqueLock is a bare OP_2DROP OP_1: any two pushes unlock it.
var opaqueLock = []byte{0x6d, 0x51}

// spendingFrom is a transaction whose one input pushes '<junk> <issuer's
// key>' to spend output 0 of a transaction locked by prevoutScript.
func spendingFrom(issuer *btcec.PrivateKey, prevoutScript []byte, n byte, outputs [][]byte) testTx {
	prev := buildTx([]testInput{{txid: fundingTxid(n), vout: 0, scriptSig: covenantUnlock()}}, [][]byte{prevoutScript})
	tx := buildTx([]testInput{{txid: prev.txid, vout: 0, scriptSig: p2pkhUnlock(issuer)}}, outputs)
	tx.prevs = []testTx{prev}
	return tx
}

// mintOutputs is a contract mint's outputs naming holder in postern, its
// change paid to the issuer so the mint shows in the issuer's history.
func mintOutputs(issuer *btcec.PrivateKey, holder string) [][]byte {
	return [][]byte{
		licenseScript,
		fuelScript,
		typedRecordScript("M", `{"collection":"postern","holder":"`+holder+`"}`),
		p2pkhLockTo(issuer),
	}
}

func TestAMintThatOnlyPushesTheIssuersKeyDoesNotCount(t *testing.T) {
	issuer, attacker := newTestKey(t), newTestKey(t)
	for name, prevout := range map[string][]byte{
		"OP_2DROP OP_1":               opaqueLock,
		"P2PKH to the attacker":       p2pkhLockTo(attacker),
		"P2PKH to another hash":       p2pkhLock(addressOf(issuer)),
		"the issuer's P2PKH + op":     append(append([]byte{}, p2pkhLockTo(issuer)...), 0x51),
		"a typed record, unspendable": typedRecordScript("W", `{}`),
	} {
		reader := newFakeReader()
		reader.add(spendingFrom(issuer, prevout, 0xa1, mintOutputs(issuer, addressOf(attacker))), addressOf(issuer))

		got, err := HeldCollections(reader, addressOf(attacker), Rule{IssuerKey: pubHex(issuer)})
		if err != nil || len(got) != 0 {
			t.Errorf("prevout %s: collections = %v, %v, want none and no error", name, got, err)
		}
	}
}

func TestAMintSpendingAnOutputP2PKHToTheIssuerCounts(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	reader := newFakeReader()
	reader.add(spendingFrom(issuer, p2pkhLockTo(issuer), 0xa1, mintOutputs(issuer, addressOf(holder))), addressOf(issuer))

	if !mustHeld(t, reader, addressOf(holder), Rule{IssuerKey: pubHex(issuer)}) {
		t.Fatal("held = false, want true for a mint spending the issuer's own P2PKH coin")
	}
}

func TestARevokeThatOnlyPushesTheIssuersKeyDoesNotRevoke(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	mint := contractMint(issuer, "postern", addressOf(holder))
	revoke := [][]byte{typedRecordScript("W", `{"kind":"revoke","origin":"`+mint.txid+`:0"}`), p2pkhLockTo(issuer)}
	reader := newFakeReader()
	reader.add(mint, addressOf(issuer))
	reader.add(spendingFrom(issuer, opaqueLock, 0xa2, revoke), addressOf(issuer))
	rule := Rule{IssuerKey: pubHex(issuer)}

	if !mustHeld(t, reader, addressOf(holder), rule) {
		t.Fatal("held = false, want true: a revoke spending OP_2DROP OP_1 was not signed by the issuer")
	}

	reader.add(spendingFrom(issuer, p2pkhLockTo(issuer), 0xa3, revoke), addressOf(issuer))
	if mustHeld(t, reader, addressOf(holder), rule) {
		t.Fatal("held = true, want false once a revoke spending the issuer's P2PKH coin names the mint")
	}
}

func TestAMintWhosePrevoutCannotBeReadDoesNotCount(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	mint := contractMint(issuer, "postern", addressOf(holder))
	reader := newFakeReader()
	reader.add(mint, addressOf(issuer))
	reader.txErr[mint.prevs[0].txid] = errors.New("WhatsOnChain said 503")

	held, err := Held(reader, addressOf(holder), Rule{IssuerKey: pubHex(issuer)})
	if held || err == nil {
		t.Fatalf("Held = %v, %v; want false and the read failure, so the checker's stale grace keeps the last answer", held, err)
	}
}

func TestAMintWhosePrevoutIsMissingOrUnreadableDoesNotCount(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	for name, prevHex := range map[string]string{"absent": "", "not a transaction": "00", "too few outputs": fundingFor(issuer, 0xb1, 0).hex} {
		mint := contractMint(issuer, "postern", addressOf(holder)) // spends output 2
		reader := newFakeReader()
		reader.add(mint, addressOf(issuer))
		reader.txs[mint.prevs[0].txid] = prevHex

		got, err := HeldCollections(reader, addressOf(holder), Rule{IssuerKey: pubHex(issuer)})
		if err != nil || len(got) != 0 {
			t.Errorf("prevout %s: collections = %v, %v, want none", name, got, err)
		}
	}
}

func TestAColdCheckReadsAPrevoutOnlyForACandidateMintOrRevoke(t *testing.T) {
	issuer, holder, other := newTestKey(t), newTestKey(t), newTestKey(t)
	reader := newFakeReader()
	// Two mints for someone else and an issuer payment carrying no record:
	// none of them is a candidate for the holder, so no prevout is read.
	reader.add(contractMintFundedBy(issuer, "postern", addressOf(other), 0xc1), addressOf(issuer))
	reader.add(fundedBy(issuer, 0xc2, 0, [][]byte{p2pkhLockTo(other)}), addressOf(issuer))
	reader.add(revokeTx(issuer, fundingTxid(0xab)+":0", 0xc3), addressOf(issuer))
	rule := Rule{IssuerKey: pubHex(issuer)}

	if mustHeld(t, reader, addressOf(holder), rule) {
		t.Fatal("held = true, want false")
	}
	if got := reader.totalReads(); got != 3 {
		t.Fatalf("reads = %d, want 3: the history's transactions and no prevout", got)
	}

	// The holder's mint, funded from outside the issuer's history: one read.
	reader = newFakeReader()
	mint := contractMint(issuer, "postern", addressOf(holder))
	reader.add(mint, addressOf(issuer))
	if !mustHeld(t, reader, addressOf(holder), rule) {
		t.Fatal("held = false, want true")
	}
	if got := reader.reads[mint.prevs[0].txid]; got != 1 || reader.totalReads() != 2 {
		t.Fatalf("prevout reads = %d of %d total, want 1 of 2", got, reader.totalReads())
	}
}

func TestAColdCheckReadsNoPrevoutTheIssuersHistoryAlreadyHolds(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	mint := contractMint(issuer, "postern", addressOf(holder))
	reader := newFakeReader()
	// The coin the mint spends paid the issuer's address, so the issuer's
	// history shows the transaction that paid it.
	reader.add(mint.prevs[0], addressOf(issuer))
	reader.add(mint, addressOf(issuer))
	revoke := revokeTx(issuer, mint.txid+":0", 0xe1)
	reader.add(revoke.prevs[0], addressOf(issuer))

	if !mustHeld(t, reader, addressOf(holder), Rule{IssuerKey: pubHex(issuer)}) {
		t.Fatal("held = false, want true")
	}
	for txid, n := range reader.reads {
		if n != 1 {
			t.Fatalf("%s read %d times, want each transaction read once", txid, n)
		}
	}
	if got := reader.totalReads(); got != 3 {
		t.Fatalf("reads = %d, want 3: only the history's own transactions", got)
	}

	reader.add(revoke, addressOf(issuer))
	reader.reads = map[string]int{}
	if mustHeld(t, reader, addressOf(holder), Rule{IssuerKey: pubHex(issuer)}) {
		t.Fatal("held = true, want false once revoked")
	}
	if got := reader.totalReads(); got != 4 {
		t.Fatalf("reads = %d, want 4: the history's own transactions and no prevout", got)
	}
}
