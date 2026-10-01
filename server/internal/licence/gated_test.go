package licence

import (
	"bytes"
	"encoding/hex"
	"testing"

	"github.com/btcsuite/btcd/btcec/v2"
)

// The fixtures below are spell-forge's gated records (docs/licence-token.md):
// since mw-jeswf.3 encodeTypedRecordScript writes six pushes, OP_FALSE
// OP_RETURN <'nftgate'> <0x02> <type> <32-byte epoch commitment c(e)>
// <empty manifest 0x00> <payload>, for the M (gatedMintRecordScript, payload
// {collection, holder, wrapKey, wrap}), the W (payload the ciphertext) and
// the TR (payload {"to"}, carrying the mint's c(0)).

const spellforgeCollection = "spellforge-leaderboard-testnet"

// epochCommitment stands in for c(0) = SHA-256("nftgate-epoch" ‖ k(0)).
var epochCommitment = bytes.Repeat([]byte{0xc0}, 32)

func gatedRecordScript(recordType string, payload []byte) []byte {
	script := []byte{0x00, 0x6a}
	script = append(script, pushData([]byte("nftgate"))...)
	script = append(script, pushData([]byte{0x02})...)
	script = append(script, pushData([]byte(recordType))...)
	script = append(script, pushData(epochCommitment)...)
	script = append(script, pushData([]byte{0x00})...)
	return append(script, pushData(payload)...)
}

// gatedMintPayload is gatedMintRecordScript's payload: the holder's 65-byte
// P-256 wrap key and a 126-byte wrap of k(0) to it, both hex, make it long
// enough to need OP_PUSHDATA2, as a real one does.
func gatedMintPayload(collection, holder string) []byte {
	wrapKey := hex.EncodeToString(append([]byte{0x04}, bytes.Repeat([]byte{0x5e}, 64)...))
	wrap := hex.EncodeToString(append([]byte{0x01}, bytes.Repeat([]byte{0xa7}, 125)...))
	return []byte(`{"collection":"` + collection + `","holder":"` + holder + `","wrapKey":"` + wrapKey + `","wrap":"` + wrap + `"}`)
}

// gatedContractMint is buildContractMintTransaction today: signer's P2PKH
// funding inputs, [0] License, [1] Fuel, [2] the 6-push M, [3] signer's change.
func gatedContractMint(signer *btcec.PrivateKey, collection, holder string) testTx {
	return fundedBy(signer, 0xf1, 2, [][]byte{
		licenseScript,
		fuelScript,
		gatedRecordScript("M", gatedMintPayload(collection, holder)),
		p2pkhLock(addressOf(signer)),
	})
}

func spellforgeRule(issuer *btcec.PrivateKey) Rule {
	return Rule{Collections: []string{"postern", spellforgeCollection}, IssuerKey: pubHex(issuer)}
}

func TestAGatedMintTheIssuerSignedHoldsTheSpellforgeCollection(t *testing.T) {
	issuer, purchaser := newTestKey(t), newTestKey(t)
	if len(gatedMintPayload(spellforgeCollection, addressOf(purchaser))) <= 0xff {
		t.Fatal("the gated M payload fixture should need OP_PUSHDATA2, as a real one does")
	}
	reader := newFakeReader()
	reader.add(gatedContractMint(issuer, spellforgeCollection, addressOf(purchaser)), addressOf(issuer))

	got := mustHeldCollections(t, reader, addressOf(purchaser), spellforgeRule(issuer))
	if len(got) != 1 || got[0] != spellforgeCollection {
		t.Fatalf("collections = %v, want [%s] for a 6-push M the issuer signed", got, spellforgeCollection)
	}
}

func TestAGatedMintSignedByAnotherKeyHoldsNothing(t *testing.T) {
	issuer, purchaser, someoneElse := newTestKey(t), newTestKey(t), newTestKey(t)
	reader := newFakeReader()
	reader.add(gatedContractMint(someoneElse, spellforgeCollection, addressOf(purchaser)), addressOf(someoneElse), addressOf(purchaser))
	// spell-forge's own mintContractLicenseToken: the purchaser self-mints.
	reader.add(gatedContractMint(purchaser, spellforgeCollection, addressOf(purchaser)), addressOf(purchaser))

	if got := mustHeldCollections(t, reader, addressOf(purchaser), spellforgeRule(issuer)); len(got) != 0 {
		t.Fatalf("collections = %v, want none while the issuer key is set and did not sign", got)
	}
}

func TestAGatedTransferSpendingTheTokenMovesItAway(t *testing.T) {
	issuer, purchaser, buyer := newTestKey(t), newTestKey(t), newTestKey(t)
	mint := gatedContractMint(issuer, spellforgeCollection, addressOf(purchaser))
	write := contractSpend(mint, gatedRecordScript("W", []byte{0x9a, 0x01, 0xfe, 0x33}))
	reader := newFakeReader()
	reader.add(mint, addressOf(issuer))
	reader.add(write, addressOf(purchaser))
	rule := spellforgeRule(issuer)
	if got := mustHeldCollections(t, reader, addressOf(purchaser), rule); len(got) != 1 {
		t.Fatalf("collections = %v after a gated write, want [%s]", got, spellforgeCollection)
	}

	reader.add(contractSpend(write, gatedRecordScript("TR", []byte(`{"to":"`+addressOf(buyer)+`"}`))), addressOf(purchaser))
	if got := mustHeldCollections(t, reader, addressOf(purchaser), rule); len(got) != 0 {
		t.Fatalf("collections = %v, want none once a 6-push TR spends the token's outpoint", got)
	}
}

func TestTheIssuersRevokeEndsAGatedLicence(t *testing.T) {
	issuer, purchaser := newTestKey(t), newTestKey(t)
	mint := gatedContractMint(issuer, spellforgeCollection, addressOf(purchaser))
	reader := newFakeReader()
	reader.add(mint, addressOf(issuer))
	rule := spellforgeRule(issuer)
	if got := mustHeldCollections(t, reader, addressOf(purchaser), rule); len(got) != 1 {
		t.Fatalf("collections = %v before the revoke, want [%s]", got, spellforgeCollection)
	}

	reader.add(revokeTx(issuer, mint.txid+":0", 0xe1), addressOf(issuer))
	if got := mustHeldCollections(t, reader, addressOf(purchaser), rule); len(got) != 0 {
		t.Fatalf("collections = %v, want none once the issuer revoked the gated licence", got)
	}
}
