package licence

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"testing"

	"github.com/Jonathan-A-White/postern/server/internal/woc"
	"github.com/btcsuite/btcd/btcec/v2"
)

// The fixtures below are shaped like spell-forge-bsv's builders really
// write them (src/bsv/license-contract.ts): a contract mint funded by the
// issuer's P2PKH inputs with outputs [0] the 1-sat License, [1] the Fuel,
// [2] a typed M record {"collection","holder"}, [3] the issuer's change; a
// transfer whose input 0 spends the License outpoint (input 1 the Fuel) and
// whose outputs are [0] the License to the new owner, [1] the Fuel, [2] a
// typed TR record {"to": <new owner's address>}; a write the same, with a W
// record. Scripts the rule never reads (the License and Fuel locking
// scripts, the covenant unlocking scripts) are opaque stand-ins.

// writeVarInt writes a Bitcoin CompactSize integer (up to 0xffff).
func writeVarInt(buf *bytes.Buffer, n uint64) {
	switch {
	case n < 0xfd:
		buf.WriteByte(byte(n))
	case n <= 0xffff:
		buf.WriteByte(0xfd)
		binary.Write(buf, binary.LittleEndian, uint16(n))
	default:
		panic("writeVarInt test helper only supports counts up to 0xffff")
	}
}

// pushData encodes a push the way @bsv/sdk's writeBin does.
func pushData(data []byte) []byte {
	var out []byte
	switch {
	case len(data) < 0x4c:
		out = append(out, byte(len(data)))
	case len(data) <= 0xff:
		out = append(out, 0x4c, byte(len(data)))
	default:
		out = append(out, 0x4d)
		out = binary.LittleEndian.AppendUint16(out, uint16(len(data)))
	}
	return append(out, data...)
}

// typedRecordScript is encodeTypedRecordScript's output: OP_FALSE OP_RETURN
// <'nftgate'> <0x02> <type> <empty manifest 0x00> <payload>.
func typedRecordScript(recordType string, payload string) []byte {
	script := []byte{0x00, 0x6a}
	script = append(script, pushData([]byte("nftgate"))...)
	script = append(script, pushData([]byte{0x02})...)
	script = append(script, pushData([]byte(recordType))...)
	script = append(script, pushData([]byte{0x00})...)
	return append(script, pushData([]byte(payload))...)
}

var (
	licenseScript = append([]byte{0x01, 0x4c}, bytes.Repeat([]byte{0x7e}, 40)...) // stand-in for the License covenant
	fuelScript    = append([]byte{0x01, 0x46}, bytes.Repeat([]byte{0x7c}, 30)...) // stand-in for Fuel(C)
)

func p2pkhLock(address string) []byte {
	hash := sha256.Sum256([]byte(address)) // any 20 bytes; only the shape matters
	script := []byte{0x76, 0xa9}
	script = append(script, pushData(hash[:20])...)
	return append(script, 0x88, 0xac)
}

// p2pkhUnlock is <sig> <pubkey>, the scriptSig @bsv/sdk's P2PKH().unlock
// writes (the signature bytes aren't checked by the rule).
func p2pkhUnlock(key *btcec.PrivateKey) []byte {
	sig := append(bytes.Repeat([]byte{0x30}, 70), 0x41)
	return append(pushData(sig), pushData(key.PubKey().SerializeCompressed())...)
}

// covenantUnlock stands in for the License's or the Fuel's method call:
// several pushes, never a P2PKH shape.
func covenantUnlock() []byte {
	var script []byte
	for _, size := range []int{72, 200, 1} {
		script = append(script, pushData(bytes.Repeat([]byte{0x5a}, size))...)
	}
	return script
}

type testInput struct {
	txid      string
	vout      uint32
	scriptSig []byte
}

type testTx struct {
	txid string
	hex  string
}

// buildTx serializes a transaction and names it by its real txid.
func buildTx(inputs []testInput, outputs [][]byte) testTx {
	var buf bytes.Buffer
	binary.Write(&buf, binary.LittleEndian, uint32(1))
	writeVarInt(&buf, uint64(len(inputs)))
	for _, in := range inputs {
		prev, err := hex.DecodeString(in.txid)
		if err != nil || len(prev) != 32 {
			panic(fmt.Sprintf("bad input txid %q", in.txid))
		}
		for i, j := 0, len(prev)-1; i < j; i, j = i+1, j-1 {
			prev[i], prev[j] = prev[j], prev[i]
		}
		buf.Write(prev)
		binary.Write(&buf, binary.LittleEndian, in.vout)
		writeVarInt(&buf, uint64(len(in.scriptSig)))
		buf.Write(in.scriptSig)
		binary.Write(&buf, binary.LittleEndian, uint32(0xffffffff))
	}
	writeVarInt(&buf, uint64(len(outputs)))
	for _, script := range outputs {
		binary.Write(&buf, binary.LittleEndian, uint64(1))
		writeVarInt(&buf, uint64(len(script)))
		buf.Write(script)
	}
	binary.Write(&buf, binary.LittleEndian, uint32(0))

	first := sha256.Sum256(buf.Bytes())
	second := sha256.Sum256(first[:])
	for i, j := 0, len(second)-1; i < j; i, j = i+1, j-1 {
		second[i], second[j] = second[j], second[i]
	}
	return testTx{txid: hex.EncodeToString(second[:]), hex: hex.EncodeToString(buf.Bytes())}
}

// fundingTxid is a UTXO the minter spends: any txid the chain never shows.
func fundingTxid(n byte) string {
	return hex.EncodeToString(bytes.Repeat([]byte{n}, 32))
}

// contractMint is buildContractMintTransaction's layout, funded by signer.
func contractMint(signer *btcec.PrivateKey, collection, holder string) testTx {
	signerAddress := addressOf(signer)
	return buildTx(
		[]testInput{{txid: fundingTxid(0xf1), vout: 2, scriptSig: p2pkhUnlock(signer)}},
		[][]byte{
			licenseScript,
			fuelScript,
			typedRecordScript("M", `{"collection":"`+collection+`","holder":"`+holder+`"}`),
			p2pkhLock(signerAddress),
		},
	)
}

// contractSpend is a License spend (transfer or write) of the licence at
// txid:0 through the Fuel at txid:1, carrying record.
func contractSpend(licence testTx, record []byte) testTx {
	return buildTx(
		[]testInput{
			{txid: licence.txid, vout: 0, scriptSig: covenantUnlock()},
			{txid: licence.txid, vout: 1, scriptSig: covenantUnlock()},
		},
		[][]byte{licenseScript, fuelScript, record},
	)
}

func newTestKey(t *testing.T) *btcec.PrivateKey {
	t.Helper()
	key, err := btcec.NewPrivateKey()
	if err != nil {
		t.Fatalf("NewPrivateKey: %v", err)
	}
	return key
}

func pubHex(key *btcec.PrivateKey) string {
	return hex.EncodeToString(key.PubKey().SerializeCompressed())
}

func addressOf(key *btcec.PrivateKey) string {
	address, err := AddressForPublicKey(pubHex(key))
	if err != nil {
		panic(err)
	}
	return address
}

// fakeReader is a chain reader test double: address -> history, txid -> raw hex.
type fakeReader struct {
	history map[string][]woc.HistoryEntry
	txs     map[string]string
	err     error
}

func newFakeReader() *fakeReader {
	return &fakeReader{history: map[string][]woc.HistoryEntry{}, txs: map[string]string{}}
}

// add puts tx on chain, in the history of each of addresses.
func (f *fakeReader) add(tx testTx, addresses ...string) {
	f.txs[tx.txid] = tx.hex
	for _, address := range addresses {
		f.history[address] = append(f.history[address], woc.HistoryEntry{TxHash: tx.txid, Height: 100 + len(f.history[address])})
	}
}

func (f *fakeReader) GetHistory(address string) ([]woc.HistoryEntry, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.history[address], nil
}

func (f *fakeReader) GetTransactionHex(txid string) (string, error) {
	return f.txs[txid], nil
}

func mustHeld(t *testing.T, reader Reader, address string, rule Rule) bool {
	t.Helper()
	held, err := Held(reader, address, rule)
	if err != nil {
		t.Fatalf("Held: %v", err)
	}
	return held
}

func TestHeldForAMintSignedByTheIssuer(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	mint := contractMint(issuer, "postern", addressOf(holder))
	reader := newFakeReader()
	// A contract mint pays nothing to the holder's address: it shows only in
	// the issuer's history (the funding inputs and the change).
	reader.add(mint, addressOf(issuer))

	if !mustHeld(t, reader, addressOf(holder), Rule{IssuerKey: pubHex(issuer)}) {
		t.Fatal("held = false, want true for a mint the issuer signed")
	}
}

func TestHeldIgnoresAMintNotSignedByTheIssuer(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	selfMint := contractMint(holder, "postern", addressOf(holder))
	reader := newFakeReader()
	reader.add(selfMint, addressOf(holder))

	if mustHeld(t, reader, addressOf(holder), Rule{IssuerKey: pubHex(issuer)}) {
		t.Fatal("held = true for a self-minted licence, want false once an issuer is configured")
	}
}

func TestHeldForASelfMintWhenNoIssuerIsConfigured(t *testing.T) {
	holder := newTestKey(t)
	selfMint := contractMint(holder, "spellforge-leaderboard-testnet", addressOf(holder))
	reader := newFakeReader()
	reader.add(selfMint, addressOf(holder))

	if !mustHeld(t, reader, addressOf(holder), Rule{}) {
		t.Fatal("held = false, want the old self-mint rule with no issuer configured")
	}
}

func TestHeldForAnIssuerMintingToItself(t *testing.T) {
	issuer := newTestKey(t)
	mint := contractMint(issuer, "postern", addressOf(issuer))
	reader := newFakeReader()
	reader.add(mint, addressOf(issuer))

	if !mustHeld(t, reader, addressOf(issuer), Rule{IssuerKey: pubHex(issuer)}) {
		t.Fatal("held = false, want true for the issuer's own licence")
	}
}

func TestHeldOnlyForTheConfiguredCollections(t *testing.T) {
	holder := newTestKey(t)
	for _, tc := range []struct {
		collection string
		rule       Rule
		want       bool
	}{
		{"postern", Rule{}, true},
		{"spellforge-leaderboard-testnet", Rule{}, true},
		{"some-other-collection", Rule{}, false},
		{"spellforge-leaderboard-testnet", Rule{Collections: []string{"postern"}}, false},
		{"some-other-collection", Rule{Collections: []string{"postern", "some-other-collection"}}, true},
	} {
		reader := newFakeReader()
		reader.add(contractMint(holder, tc.collection, addressOf(holder)), addressOf(holder))
		if got := mustHeld(t, reader, addressOf(holder), tc.rule); got != tc.want {
			t.Fatalf("collection %q, rule %+v: held = %v, want %v", tc.collection, tc.rule, got, tc.want)
		}
	}
}

func TestHeldFalseWithNoMint(t *testing.T) {
	if mustHeld(t, newFakeReader(), addressOf(newTestKey(t)), Rule{}) {
		t.Fatal("held = true, want false")
	}
}

func TestHeldFalseForAMintNamingADifferentHolder(t *testing.T) {
	holder, someoneElse := newTestKey(t), newTestKey(t)
	reader := newFakeReader()
	reader.add(contractMint(holder, "postern", addressOf(someoneElse)), addressOf(holder))

	if mustHeld(t, reader, addressOf(holder), Rule{}) {
		t.Fatal("held = true, want false for a mint naming a different holder")
	}
}

func TestHeldFalseOnceTheLibrarysTransferSpendsTheLicence(t *testing.T) {
	issuer, holder, buyer := newTestKey(t), newTestKey(t), newTestKey(t)
	mint := contractMint(issuer, "postern", addressOf(holder))
	transfer := contractSpend(mint, typedRecordScript("TR", `{"to":"`+addressOf(buyer)+`"}`))
	reader := newFakeReader()
	reader.add(mint, addressOf(issuer))
	reader.add(transfer, addressOf(holder))

	if mustHeld(t, reader, addressOf(holder), Rule{IssuerKey: pubHex(issuer)}) {
		t.Fatal("held = true, want false once a {\"to\"} transfer spends the licence's outpoint")
	}
}

func TestHeldFalseOnceALegacyTransferSpendsTheLicence(t *testing.T) {
	holder, buyer := newTestKey(t), newTestKey(t)
	mint := contractMint(holder, "spellforge-leaderboard-testnet", addressOf(holder))
	transfer := contractSpend(mint, typedRecordScript("TR", `{"origin":"`+mint.txid+`:0","to":"`+addressOf(buyer)+`"}`))
	reader := newFakeReader()
	reader.add(mint, addressOf(holder))
	reader.add(transfer, addressOf(holder))

	if mustHeld(t, reader, addressOf(holder), Rule{}) {
		t.Fatal("held = true, want false once an {\"origin\",\"to\"} transfer spends the licence's outpoint")
	}
}

func TestHeldIgnoresATransferThatDoesNotSpendTheLicence(t *testing.T) {
	holder, buyer := newTestKey(t), newTestKey(t)
	mint := contractMint(holder, "postern", addressOf(holder))
	// Names the licence's origin in its payload, but spends the mint's
	// change output, not the License: it moves nothing.
	bogus := buildTx(
		[]testInput{{txid: mint.txid, vout: 3, scriptSig: p2pkhUnlock(holder)}},
		[][]byte{licenseScript, fuelScript, typedRecordScript("TR", `{"origin":"`+mint.txid+`:0","to":"`+addressOf(buyer)+`"}`)},
	)
	reader := newFakeReader()
	reader.add(mint, addressOf(holder))
	reader.add(bogus, addressOf(holder))

	if !mustHeld(t, reader, addressOf(holder), Rule{}) {
		t.Fatal("held = false, want true: a TR is tied to a licence by the outpoint it spends, never by its payload")
	}
}

func TestHeldFollowsTheLicenceThroughWritesAndSelfTransfers(t *testing.T) {
	holder, buyer := newTestKey(t), newTestKey(t)
	mint := contractMint(holder, "postern", addressOf(holder))
	write := contractSpend(mint, typedRecordScript("W", `{"text":"hello"}`))
	toSelf := contractSpend(write, typedRecordScript("TR", `{"to":"`+addressOf(holder)+`"}`))
	reader := newFakeReader()
	for _, tx := range []testTx{mint, write, toSelf} {
		reader.add(tx, addressOf(holder))
	}

	if !mustHeld(t, reader, addressOf(holder), Rule{}) {
		t.Fatal("held = false after a write and a transfer to itself, want true")
	}

	away := contractSpend(toSelf, typedRecordScript("TR", `{"to":"`+addressOf(buyer)+`"}`))
	reader.add(away, addressOf(holder))
	if mustHeld(t, reader, addressOf(holder), Rule{}) {
		t.Fatal("held = true, want false once the licence's current outpoint is transferred away")
	}
}

func TestHeldForAFreshMintAfterAnEarlierOneWasTransferredAway(t *testing.T) {
	issuer, holder, buyer := newTestKey(t), newTestKey(t), newTestKey(t)
	oldMint := contractMint(holder, "spellforge-leaderboard-testnet", addressOf(holder))
	transfer := contractSpend(oldMint, typedRecordScript("TR", `{"to":"`+addressOf(buyer)+`"}`))
	newMint := contractMint(issuer, "postern", addressOf(holder))
	reader := newFakeReader()
	reader.add(oldMint, addressOf(holder))
	reader.add(transfer, addressOf(holder))
	reader.add(newMint, addressOf(issuer))

	if !mustHeld(t, reader, addressOf(holder), Rule{IssuerKey: pubHex(issuer)}) {
		t.Fatal("held = false, want true for the re-minted licence")
	}
}

func TestHeldReportsAChainReadFailure(t *testing.T) {
	reader := newFakeReader()
	reader.err = errors.New("WhatsOnChain said 503")
	if _, err := Held(reader, addressOf(newTestKey(t)), Rule{}); err == nil {
		t.Fatal("Held = nil error, want the reader's failure")
	}
}

func TestHeldRejectsAMalformedIssuerKey(t *testing.T) {
	if _, err := Held(newFakeReader(), addressOf(newTestKey(t)), Rule{IssuerKey: "02abcd"}); err == nil {
		t.Fatal("Held = nil error, want an error for a malformed issuer key")
	}
}

func TestAddressForPublicKeyIsStableAndTestnet(t *testing.T) {
	pubKeyHex := pubHex(newTestKey(t))

	address, err := AddressForPublicKey(pubKeyHex)
	if err != nil {
		t.Fatalf("AddressForPublicKey: %v", err)
	}
	if address == "" {
		t.Fatal("address is empty")
	}
	if address[0] != 'm' && address[0] != 'n' {
		t.Fatalf("address = %q, want a testnet P2PKH address (starting m or n)", address)
	}

	again, err := AddressForPublicKey(pubKeyHex)
	if err != nil {
		t.Fatalf("AddressForPublicKey: %v", err)
	}
	if again != address {
		t.Fatalf("AddressForPublicKey is not deterministic: %q != %q", again, address)
	}
}

func TestAddressForPublicKeyRejectsInvalidHex(t *testing.T) {
	if _, err := AddressForPublicKey("not-hex"); err == nil {
		t.Fatal("expected an error for invalid public key hex")
	}
}

func mustHeldCollections(t *testing.T, reader Reader, address string, rule Rule) []string {
	t.Helper()
	collections, err := HeldCollections(reader, address, rule)
	if err != nil {
		t.Fatalf("HeldCollections: %v", err)
	}
	return collections
}

func TestHeldCollectionsNamesEveryCollectionTheKeyHoldsALicenceIn(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	reader := newFakeReader()
	reader.add(contractMint(issuer, "cairn", addressOf(holder)), addressOf(issuer))
	reader.add(contractMint(issuer, "postern", addressOf(holder)), addressOf(issuer))
	rule := Rule{Collections: []string{"postern", "cairn"}, IssuerKey: pubHex(issuer)}

	got := mustHeldCollections(t, reader, addressOf(holder), rule)
	if len(got) != 2 || got[0] != "cairn" || got[1] != "postern" {
		t.Fatalf("collections = %v, want [cairn postern] (in mint order)", got)
	}
}

func TestHeldCollectionsNamesACollectionOnceForTwoLicencesInIt(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	reader := newFakeReader()
	reader.add(contractMint(issuer, "cairn", addressOf(holder)), addressOf(issuer))
	reader.add(contractMintFundedBy(issuer, "cairn", addressOf(holder), 0xf2), addressOf(issuer))

	got := mustHeldCollections(t, reader, addressOf(holder), Rule{Collections: []string{"cairn"}, IssuerKey: pubHex(issuer)})
	if len(got) != 1 || got[0] != "cairn" {
		t.Fatalf("collections = %v, want [cairn]", got)
	}
}

func TestHeldCollectionsLeavesOutALicenceTransferredAway(t *testing.T) {
	issuer, holder, buyer := newTestKey(t), newTestKey(t), newTestKey(t)
	cairn := contractMint(issuer, "cairn", addressOf(holder))
	reader := newFakeReader()
	reader.add(cairn, addressOf(issuer))
	reader.add(contractMint(issuer, "postern", addressOf(holder)), addressOf(issuer))
	reader.add(contractSpend(cairn, typedRecordScript("TR", `{"to":"`+addressOf(buyer)+`"}`)), addressOf(holder))

	got := mustHeldCollections(t, reader, addressOf(holder), Rule{Collections: []string{"postern", "cairn"}, IssuerKey: pubHex(issuer)})
	if len(got) != 1 || got[0] != "postern" {
		t.Fatalf("collections = %v, want [postern] once the cairn licence is transferred away", got)
	}
}

func TestHeldCollectionsEmptyWithNoLicence(t *testing.T) {
	if got := mustHeldCollections(t, newFakeReader(), addressOf(newTestKey(t)), Rule{}); len(got) != 0 {
		t.Fatalf("collections = %v, want none", got)
	}
}

// contractMintFundedBy is contractMint funded by a different UTXO, so two
// mints of the same licence get txids of their own.
func contractMintFundedBy(signer *btcec.PrivateKey, collection, holder string, funding byte) testTx {
	return buildTx(
		[]testInput{{txid: fundingTxid(funding), vout: 2, scriptSig: p2pkhUnlock(signer)}},
		[][]byte{
			licenseScript,
			fuelScript,
			typedRecordScript("M", `{"collection":"`+collection+`","holder":"`+holder+`"}`),
			p2pkhLock(addressOf(signer)),
		},
	)
}

// revokeTx is the transaction the Key screen's Revoke writes: a typed W
// record {"kind":"revoke","origin":origin} in a transaction whose P2PKH
// input signer signed.
func revokeTx(signer *btcec.PrivateKey, origin string, funding byte) testTx {
	return buildTx(
		[]testInput{{txid: fundingTxid(funding), vout: 0, scriptSig: p2pkhUnlock(signer)}},
		[][]byte{
			typedRecordScript("W", `{"kind":"revoke","origin":"`+origin+`"}`),
			p2pkhLock(addressOf(signer)),
		},
	)
}

func TestHeldCollectionsLeavesOutALicenceTheIssuerRevoked(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	cairn := contractMint(issuer, "cairn", addressOf(holder))
	reader := newFakeReader()
	reader.add(cairn, addressOf(issuer))
	reader.add(contractMint(issuer, "postern", addressOf(holder)), addressOf(issuer))
	reader.add(revokeTx(issuer, cairn.txid+":0", 0xe1), addressOf(issuer))

	got := mustHeldCollections(t, reader, addressOf(holder), Rule{Collections: []string{"postern", "cairn"}, IssuerKey: pubHex(issuer)})
	if len(got) != 1 || got[0] != "postern" {
		t.Fatalf("collections = %v, want [postern] once the cairn licence is revoked", got)
	}
}

func TestHeldFalseOnceTheIssuerRevokesTheOnlyLicence(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	mint := contractMint(issuer, "postern", addressOf(holder))
	reader := newFakeReader()
	reader.add(mint, addressOf(issuer))
	reader.add(revokeTx(issuer, mint.txid+":0", 0xe1), addressOf(issuer))

	if mustHeld(t, reader, addressOf(holder), Rule{IssuerKey: pubHex(issuer)}) {
		t.Fatal("held = true after the issuer revoked the licence, want false")
	}
}

func TestHeldStaysFalseWhateverLaterTransfersDoWithARevokedToken(t *testing.T) {
	issuer, holder, buyer := newTestKey(t), newTestKey(t), newTestKey(t)
	mint := contractMint(issuer, "postern", addressOf(holder))
	reader := newFakeReader()
	reader.add(mint, addressOf(issuer))
	reader.add(revokeTx(issuer, mint.txid+":0", 0xe1), addressOf(issuer))
	// The token is then moved to the buyer, and back to the holder.
	toBuyer := contractSpend(mint, typedRecordScript("TR", `{"to":"`+addressOf(buyer)+`"}`))
	reader.add(toBuyer, addressOf(issuer))
	reader.add(contractSpend(toBuyer, typedRecordScript("TR", `{"to":"`+addressOf(holder)+`"}`)), addressOf(issuer))

	rule := Rule{IssuerKey: pubHex(issuer)}
	if mustHeld(t, reader, addressOf(holder), rule) || mustHeld(t, reader, addressOf(buyer), rule) {
		t.Fatal("held = true through a revoked token, want false for everyone")
	}
}

func TestHeldIgnoresARevokeTheHolderSignedItself(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	mint := contractMint(issuer, "cairn", addressOf(holder))
	reader := newFakeReader()
	reader.add(mint, addressOf(issuer))
	reader.add(revokeTx(holder, mint.txid+":0", 0xe1), addressOf(holder), addressOf(issuer))

	got := mustHeldCollections(t, reader, addressOf(holder), Rule{Collections: []string{"cairn"}, IssuerKey: pubHex(issuer)})
	if len(got) != 1 || got[0] != "cairn" {
		t.Fatalf("collections = %v, want [cairn]: a revoke not signed by the issuer changes nothing", got)
	}
}

func TestHeldIgnoresARevokeOutsideTheIssuersHistory(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	mint := contractMint(issuer, "cairn", addressOf(holder))
	reader := newFakeReader()
	reader.add(mint, addressOf(issuer))
	// Signed by the issuer's key, but only the holder's history shows it.
	reader.add(revokeTx(issuer, mint.txid+":0", 0xe1), addressOf(holder))

	got := mustHeldCollections(t, reader, addressOf(holder), Rule{Collections: []string{"cairn"}, IssuerKey: pubHex(issuer)})
	if len(got) != 1 {
		t.Fatalf("collections = %v, want [cairn]: a revoke is read from the issuer's history only", got)
	}
}

func TestHeldIgnoresARevokeNamingTheWrongOrigin(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	mint := contractMint(issuer, "cairn", addressOf(holder))
	reader := newFakeReader()
	reader.add(mint, addressOf(issuer))
	reader.add(revokeTx(issuer, fundingTxid(0xab)+":0", 0xe1), addressOf(issuer))
	reader.add(revokeTx(issuer, mint.txid+":2", 0xe2), addressOf(issuer)) // the M record's output, not the token

	got := mustHeldCollections(t, reader, addressOf(holder), Rule{Collections: []string{"cairn"}, IssuerKey: pubHex(issuer)})
	if len(got) != 1 || got[0] != "cairn" {
		t.Fatalf("collections = %v, want [cairn]: a revoke naming another origin changes nothing", got)
	}
}

func TestHeldIgnoresAWriteThatIsNotARevoke(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	mint := contractMint(issuer, "cairn", addressOf(holder))
	reader := newFakeReader()
	reader.add(mint, addressOf(issuer))
	for i, payload := range []string{
		`{"kind":"note","origin":"` + mint.txid + `:0"}`,
		`{"origin":"` + mint.txid + `:0"}`,
		`{"kind":"revoke"}`,
		`not json`,
	} {
		reader.add(buildTx(
			[]testInput{{txid: fundingTxid(byte(0xd0 + i)), vout: 0, scriptSig: p2pkhUnlock(issuer)}},
			[][]byte{typedRecordScript("W", payload), p2pkhLock(addressOf(issuer))},
		), addressOf(issuer))
	}
	// The right payload under another record type is not a revoke either.
	reader.add(buildTx(
		[]testInput{{txid: fundingTxid(0xc0), vout: 0, scriptSig: p2pkhUnlock(issuer)}},
		[][]byte{typedRecordScript("TR", `{"kind":"revoke","origin":"`+mint.txid+`:0"}`), p2pkhLock(addressOf(issuer))},
	), addressOf(issuer))

	got := mustHeldCollections(t, reader, addressOf(holder), Rule{Collections: []string{"cairn"}, IssuerKey: pubHex(issuer)})
	if len(got) != 1 || got[0] != "cairn" {
		t.Fatalf("collections = %v, want [cairn]: only a W record {kind: revoke, origin} revokes", got)
	}
}

func TestHeldHoldsAgainWithAMintAfterTheRevoke(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	first := contractMint(issuer, "cairn", addressOf(holder))
	reader := newFakeReader()
	reader.add(first, addressOf(issuer))
	reader.add(revokeTx(issuer, first.txid+":0", 0xe1), addressOf(issuer))
	rule := Rule{Collections: []string{"cairn"}, IssuerKey: pubHex(issuer)}
	if got := mustHeldCollections(t, reader, addressOf(holder), rule); len(got) != 0 {
		t.Fatalf("collections = %v before the new mint, want none", got)
	}

	reader.add(contractMintFundedBy(issuer, "cairn", addressOf(holder), 0xf2), addressOf(issuer))
	if got := mustHeldCollections(t, reader, addressOf(holder), rule); len(got) != 1 || got[0] != "cairn" {
		t.Fatalf("collections = %v, want [cairn]: a mint after the revoke is a new licence", got)
	}
}

func TestHeldNeverReadsARevokeWithNoIssuerConfigured(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	mint := contractMint(holder, "cairn", addressOf(holder))
	reader := newFakeReader()
	reader.add(mint, addressOf(holder))
	reader.add(revokeTx(issuer, mint.txid+":0", 0xe1), addressOf(holder))

	got := mustHeldCollections(t, reader, addressOf(holder), Rule{Collections: []string{"cairn"}})
	if len(got) != 1 || got[0] != "cairn" {
		t.Fatalf("collections = %v, want [cairn]: with no issuer a revoke record is never read", got)
	}
}
