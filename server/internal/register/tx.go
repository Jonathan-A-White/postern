package register

// The site issuer's transactions, built here rather than by a library: a
// Lampas licence mint and its revoke, in exactly the bytes the TS issuer
// writes (src/services/issue.ts issueLicence through spell-forge-bsv's
// buildContractMintTransaction, and revokeLicence), which
// testdata/site-issuer-golden.json holds and issue_test.go compares. Keys and
// signatures are btcec's (RFC 6979 nonces and low S, as @bsv/sdk signs); the
// rest is the plain BSV serialisation, the BIP-143 sighash with FORKID, and
// @bsv/sdk's fee arithmetic, all small enough to read whole.

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"github.com/Jonathan-A-White/postern/server/internal/licence"
	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/ecdsa"
	"golang.org/x/crypto/ripemd160" //nolint:staticcheck // Bitcoin/BSV addresses are defined in terms of RIPEMD-160.
)

const (
	// LampasCollection is the collection a site licence is minted in
	// (lampas src/config.ts COLLECTION).
	LampasCollection = "lampas"
	// MintFuelSatoshis and FeeRateSatPerKb are spell-forge-bsv's chainConfig
	// mintFuelSatoshis and feeRateSatPerKb.
	MintFuelSatoshis = 10_000
	FeeRateSatPerKb  = 1
	// MintCostSatoshis is what a balance must reach before a mint is built,
	// as src/services/mint.ts's mintCostSatoshis has it: the Fuel, the 1-sat
	// License, the fee of a 6,000-byte transaction and 1 sat of change.
	MintCostSatoshis = MintFuelSatoshis + licenceSatoshis + (estimatedMintBytes*FeeRateSatPerKb+999)/1000 + 1

	licenceSatoshis    = 1
	anchorSatoshis     = 1
	estimatedMintBytes = 6_000

	sighashAllForkID = 0x41
	// p2pkhUnlockEstimate is @bsv/sdk's P2PKH estimateLength: a signature
	// push (1+73) and a public key push (1+33).
	p2pkhUnlockEstimate = 108
)

var (
	//go:embed contracts/license.json
	licenseArtifact []byte
	//go:embed contracts/fuel.json
	fuelArtifact []byte

	// recordProtocol and the bytes around it are spell-forge-bsv's typed
	// record (record.js encodeTypedRecordScript): OP_FALSE OP_RETURN
	// "nftgate" 0x02 <type> 0x00 <payload>.
	recordProtocol = []byte("nftgate")
)

const (
	recordVersionTyped = 0x02
	opFalse            = 0x00
	opReturn           = 0x6a
	opPushData1        = 0x4c
	opPushData2        = 0x4d
	opPushData4        = 0x4e
)

// errNotEnough says the site address cannot pay for what was asked.
type errNotEnough struct{ needed, held int64 }

func (e *errNotEnough) Error() string {
	return fmt.Sprintf("not enough sats: this needs about %d and the site address holds %d", e.needed, e.held)
}

// coin is a spendable output of the site address: P2PKH to its key.
type coin struct {
	txid     string
	vout     uint32
	satoshis int64
}

func (c coin) key() string { return fmt.Sprintf("%s:%d", c.txid, c.vout) }

type txInput struct {
	prev       coin
	prevScript []byte
	script     []byte // the unlocking script, once signed
}

type txOutput struct {
	satoshis int64
	script   []byte
	change   bool
}

// transaction is a version 1, lock time 0 transaction whose inputs all spend
// the one key's P2PKH coins, as both the mint and the revoke are.
type transaction struct {
	inputs  []txInput
	outputs []txOutput
}

// eligible is the coins the TS builders spend: all but 1-sat outputs
// (spell-forge-bsv's selectFeeUtxos: a 1-sat output may be a token).
func eligible(coins []coin) []coin {
	var out []coin
	for _, c := range coins {
		if c.satoshis != 1 {
			out = append(out, c)
		}
	}
	return out
}

// buildMint is buildContractMintTransaction for the site key: every eligible
// coin in, then [0] the 1-sat License owned by holder, [1] Fuel(collection)
// with MintFuelSatoshis, [2] the type-M record {collection, holder} and [3]
// the change back to the site address, fee at FeeRateSatPerKb, signed.
func buildMint(key *btcec.PrivateKey, coins []coin, holder []byte, collection string) (*transaction, error) {
	spend := eligible(coins)
	if held := total(spend); len(spend) == 0 || held < MintCostSatoshis {
		return nil, &errNotEnough{needed: MintCostSatoshis, held: held}
	}
	holderAddress, err := licence.AddressForPublicKey(hex.EncodeToString(holder))
	if err != nil {
		return nil, fmt.Errorf("holder key: %w", err)
	}
	fuel, err := fuelScript(collection)
	if err != nil {
		return nil, err
	}
	license, err := licenseScript(collection, fuel, holder)
	if err != nil {
		return nil, err
	}
	payload, err := json.Marshal(struct {
		Collection string `json:"collection"`
		Holder     string `json:"holder"`
	}{collection, holderAddress})
	if err != nil {
		return nil, err
	}
	own := p2pkhScript(hash160(key.PubKey().SerializeCompressed()))
	tx := spending(spend, own)
	tx.outputs = []txOutput{
		{satoshis: licenceSatoshis, script: license},
		{satoshis: MintFuelSatoshis, script: fuel},
		{satoshis: 0, script: typedRecordScript("M", payload)},
		{script: own, change: true},
	}
	if err := tx.fee(); err != nil {
		return nil, err
	}
	tx.sign(key)
	return tx, nil
}

// buildRevoke is revokeLicence for the site key: every eligible coin in, then
// [0] the type-W record {"kind":"revoke","origin"}, [1] 1 sat to the anchor
// and [2] the change, signed.
func buildRevoke(key *btcec.PrivateKey, coins []coin, origin, anchor string) (*transaction, error) {
	spend := eligible(coins)
	if len(spend) == 0 {
		return nil, &errNotEnough{needed: anchorSatoshis + 1, held: 0}
	}
	anchorHash, err := addressHash(anchor)
	if err != nil {
		return nil, fmt.Errorf("anchor %s: %w", anchor, err)
	}
	payload, err := json.Marshal(struct {
		Kind   string `json:"kind"`
		Origin string `json:"origin"`
	}{"revoke", origin})
	if err != nil {
		return nil, err
	}
	own := p2pkhScript(hash160(key.PubKey().SerializeCompressed()))
	tx := spending(spend, own)
	tx.outputs = []txOutput{
		{satoshis: 0, script: typedRecordScript("W", payload)},
		{satoshis: anchorSatoshis, script: p2pkhScript(anchorHash)},
		{script: own, change: true},
	}
	if err := tx.fee(); err != nil {
		return nil, err
	}
	tx.sign(key)
	return tx, nil
}

func spending(coins []coin, prevScript []byte) *transaction {
	tx := &transaction{}
	for _, c := range coins {
		tx.inputs = append(tx.inputs, txInput{prev: c, prevScript: prevScript})
	}
	return tx
}

func total(coins []coin) int64 {
	var sum int64
	for _, c := range coins {
		sum += c.satoshis
	}
	return sum
}

// fee is @bsv/sdk's Transaction.fee(new SatoshisPerKilobyte(rate)): the size
// with every unsigned input at its estimate, the fee rounded up, and what is
// left over to the one change output; none left is not enough.
func (tx *transaction) fee() error {
	size := 4 + sdkVarIntSize(len(tx.inputs))
	for _, in := range tx.inputs {
		n := p2pkhUnlockEstimate
		if in.script != nil {
			n = len(in.script)
		}
		size += 40 + sdkVarIntSize(n) + n
	}
	size += sdkVarIntSize(len(tx.outputs))
	for _, out := range tx.outputs {
		size += 8 + sdkVarIntSize(len(out.script)) + len(out.script)
	}
	size += 4
	fee := (int64(size)*FeeRateSatPerKb + 999) / 1000

	var in, out int64
	for _, i := range tx.inputs {
		in += i.prev.satoshis
	}
	for _, o := range tx.outputs {
		if !o.change {
			out += o.satoshis
		}
	}
	change := in - fee - out
	if change <= 0 {
		return &errNotEnough{needed: fee + out + 1, held: in}
	}
	for i := range tx.outputs {
		if tx.outputs[i].change {
			tx.outputs[i].satoshis = change
		}
	}
	return nil
}

// sdkVarIntSize is SatoshisPerKilobyte's getVarIntSize, boundaries and all.
func sdkVarIntSize(n int) int {
	switch {
	case n > 1<<32:
		return 9
	case n > 1<<16:
		return 5
	case n > 253:
		return 3
	}
	return 1
}

// sign unlocks every input with key: SIGHASH_ALL|FORKID over the BIP-143
// preimage, the DER signature and the compressed public key pushed.
func (tx *transaction) sign(key *btcec.PrivateKey) {
	pub := key.PubKey().SerializeCompressed()
	for i := range tx.inputs {
		digest := sha256d(tx.preimage(i))
		sig := append(ecdsa.Sign(key, digest).Serialize(), sighashAllForkID)
		tx.inputs[i].script = append(pushData(sig), pushData(pub)...)
	}
}

func (tx *transaction) preimage(i int) []byte {
	var prevouts, sequences, outputs bytes.Buffer
	for _, in := range tx.inputs {
		writeOutpoint(&prevouts, in.prev)
		writeUint32(&sequences, 0xffffffff)
	}
	for _, out := range tx.outputs {
		writeOutput(&outputs, out)
	}
	in := tx.inputs[i]
	var b bytes.Buffer
	writeUint32(&b, 1)
	b.Write(sha256d(prevouts.Bytes()))
	b.Write(sha256d(sequences.Bytes()))
	writeOutpoint(&b, in.prev)
	writeVarInt(&b, len(in.prevScript))
	b.Write(in.prevScript)
	writeUint64(&b, uint64(in.prev.satoshis))
	writeUint32(&b, 0xffffffff)
	b.Write(sha256d(outputs.Bytes()))
	writeUint32(&b, 0)
	writeUint32(&b, sighashAllForkID)
	return b.Bytes()
}

func (tx *transaction) bytes() []byte {
	var b bytes.Buffer
	writeUint32(&b, 1)
	writeVarInt(&b, len(tx.inputs))
	for _, in := range tx.inputs {
		writeOutpoint(&b, in.prev)
		writeVarInt(&b, len(in.script))
		b.Write(in.script)
		writeUint32(&b, 0xffffffff)
	}
	writeVarInt(&b, len(tx.outputs))
	for _, out := range tx.outputs {
		writeOutput(&b, out)
	}
	writeUint32(&b, 0)
	return b.Bytes()
}

func (tx *transaction) hex() string { return hex.EncodeToString(tx.bytes()) }

// txid is the double SHA-256 of the transaction, byte-reversed, hex.
func (tx *transaction) txid() string { return hex.EncodeToString(reversed(sha256d(tx.bytes()))) }

// changeCoin is the transaction's change output as a coin the site address
// can spend next.
func (tx *transaction) changeCoin() (coin, bool) {
	for i, out := range tx.outputs {
		if out.change {
			return coin{txid: tx.txid(), vout: uint32(i), satoshis: out.satoshis}, true
		}
	}
	return coin{}, false
}

func writeOutpoint(b *bytes.Buffer, c coin) {
	raw, _ := hex.DecodeString(c.txid) // checked when the coin was listed
	b.Write(reversed(raw))
	writeUint32(b, c.vout)
}

func writeOutput(b *bytes.Buffer, out txOutput) {
	writeUint64(b, uint64(out.satoshis))
	writeVarInt(b, len(out.script))
	b.Write(out.script)
}

func writeUint32(b *bytes.Buffer, v uint32) { _ = binary.Write(b, binary.LittleEndian, v) }
func writeUint64(b *bytes.Buffer, v uint64) { _ = binary.Write(b, binary.LittleEndian, v) }

func writeVarInt(b *bytes.Buffer, n int) {
	switch {
	case n < 0xfd:
		b.WriteByte(byte(n))
	case n <= 0xffff:
		b.WriteByte(0xfd)
		_ = binary.Write(b, binary.LittleEndian, uint16(n))
	case n <= 0xffffffff:
		b.WriteByte(0xfe)
		_ = binary.Write(b, binary.LittleEndian, uint32(n))
	default:
		b.WriteByte(0xff)
		_ = binary.Write(b, binary.LittleEndian, uint64(n))
	}
}

// pushData is @bsv/sdk's Script.writeBin: OP_0 for nothing, else the
// shortest length prefix (never OP_1..OP_16 for one small byte).
func pushData(data []byte) []byte {
	var b bytes.Buffer
	switch n := len(data); {
	case n == 0:
		b.WriteByte(opFalse)
	case n < opPushData1:
		b.WriteByte(byte(n))
	case n <= 0xff:
		b.WriteByte(opPushData1)
		b.WriteByte(byte(n))
	case n <= 0xffff:
		b.WriteByte(opPushData2)
		_ = binary.Write(&b, binary.LittleEndian, uint16(n))
	default:
		b.WriteByte(opPushData4)
		_ = binary.Write(&b, binary.LittleEndian, uint32(n))
	}
	b.Write(data)
	return b.Bytes()
}

func typedRecordScript(recordType string, payload []byte) []byte {
	script := []byte{opFalse, opReturn}
	for _, push := range [][]byte{recordProtocol, {recordVersionTyped}, []byte(recordType), {0x00}, payload} {
		script = append(script, pushData(push)...)
	}
	return script
}

func p2pkhScript(hash []byte) []byte {
	return append(append([]byte{0x76, 0xa9, 0x14}, hash...), 0x88, 0xac)
}

// artifactScript is a committed sCrypt artifact's locking script: its hex
// template with each <name> placeholder replaced by that value's push.
func artifactScript(artifact []byte, values map[string][]byte) ([]byte, error) {
	var a struct {
		Hex string `json:"hex"`
	}
	if err := json.Unmarshal(artifact, &a); err != nil {
		return nil, fmt.Errorf("reading a contract artifact: %w", err)
	}
	script := a.Hex
	for name, value := range values {
		placeholder := "<" + name + ">"
		if strings.Count(script, placeholder) != 1 {
			return nil, fmt.Errorf("the contract artifact has no single %s", placeholder)
		}
		script = strings.Replace(script, placeholder, hex.EncodeToString(pushData(value)), 1)
	}
	if strings.Contains(script, "<") {
		return nil, errors.New("the contract artifact has a placeholder left")
	}
	return hex.DecodeString(script)
}

// fuelScript is Fuel(collection), the artifact's script for that collection.
func fuelScript(collection string) ([]byte, error) {
	return artifactScript(fuelArtifact, map[string][]byte{"collectionId": []byte(collection)})
}

// licenseScript is a new License owned by owner: the artifact's script for
// the collection, hash256 of its Fuel and the owner, then its one state
// prop, as scrypt-ts writes a stateful contract's state: OP_RETURN, a 0x00
// byte and the owner's push, the state's length (4 bytes, little-endian) and
// the state version 0x00.
func licenseScript(collection string, fuel, owner []byte) ([]byte, error) {
	code, err := artifactScript(licenseArtifact, map[string][]byte{
		"collectionId":   []byte(collection),
		"fuelScriptHash": sha256d(fuel),
		"ownerPubKey":    owner,
	})
	if err != nil {
		return nil, err
	}
	state := append([]byte{0x00}, pushData(owner)...)
	script := append(append(code, opReturn), state...)
	script = binary.LittleEndian.AppendUint32(script, uint32(len(state)))
	return append(script, 0x00), nil
}

func sha256d(data []byte) []byte {
	first := sha256.Sum256(data)
	second := sha256.Sum256(first[:])
	return second[:]
}

func hash160(data []byte) []byte {
	sum := sha256.Sum256(data)
	h := ripemd160.New()
	h.Write(sum[:])
	return h.Sum(nil)
}

func reversed(b []byte) []byte {
	out := make([]byte, len(b))
	for i := range b {
		out[len(b)-1-i] = b[i]
	}
	return out
}

const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

// addressHash is a P2PKH address's 20-byte key hash, its checksum checked
// (mainnet 0x00 or testnet 0x6f, as @bsv/sdk's P2PKH.lock takes).
func addressHash(address string) ([]byte, error) {
	x := new(big.Int)
	for _, c := range address {
		i := strings.IndexRune(base58Alphabet, c)
		if i < 0 {
			return nil, errors.New("not a base58 address")
		}
		x.Mul(x, big.NewInt(58))
		x.Add(x, big.NewInt(int64(i)))
	}
	raw := x.Bytes()
	for _, c := range address {
		if c != '1' {
			break
		}
		raw = append([]byte{0}, raw...)
	}
	if len(raw) != 25 || !bytes.Equal(sha256d(raw[:21])[:4], raw[21:]) {
		return nil, errors.New("not a P2PKH address (bad length or checksum)")
	}
	if raw[0] != 0x00 && raw[0] != 0x6f {
		return nil, errors.New("not a P2PKH address (version byte)")
	}
	return raw[1:21], nil
}
