package record

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"strings"
	"testing"
)

// writeVarInt writes a Bitcoin CompactSize integer.
func writeVarInt(buf *bytes.Buffer, n uint64) {
	switch {
	case n < 0xfd:
		buf.WriteByte(byte(n))
	case n <= 0xffff:
		buf.WriteByte(0xfd)
		binary.Write(buf, binary.LittleEndian, uint16(n))
	case n <= 0xffffffff:
		buf.WriteByte(0xfe)
		binary.Write(buf, binary.LittleEndian, uint32(n))
	default:
		buf.WriteByte(0xff)
		binary.Write(buf, binary.LittleEndian, n)
	}
}

// pushData encodes a single push of data, using a plain length byte for
// short pushes (the only case the tests below need).
func pushData(data []byte) []byte {
	if len(data) >= 0x4c {
		panic("pushData test helper only supports short pushes")
	}
	out := make([]byte, 0, len(data)+1)
	out = append(out, byte(len(data)))
	out = append(out, data...)
	return out
}

// buildRecordScript builds OP_FALSE OP_RETURN <'nftgate'> <version> <payload>.
func buildRecordScript(version byte, payload []byte) []byte {
	var script []byte
	script = append(script, 0x00, 0x6a) // OP_FALSE OP_RETURN
	script = append(script, pushData([]byte("nftgate"))...)
	script = append(script, pushData([]byte{version})...)
	script = append(script, pushData(payload)...)
	return script
}

// buildP2PKHScript builds a plausible (not cryptographically valid, but
// correctly shaped) P2PKH locking script for "not a record" test cases.
func buildP2PKHScript() []byte {
	hash160 := bytes.Repeat([]byte{0xab}, 20)
	var script []byte
	script = append(script, 0x76, 0xa9) // OP_DUP OP_HASH160
	script = append(script, pushData(hash160)...)
	script = append(script, 0x88, 0xac) // OP_EQUALVERIFY OP_CHECKSIG
	return script
}

// buildRawTx builds a minimal serialized transaction with one dummy input
// (an empty scriptSig) and the given output scripts (each carrying 0
// satoshis, which is fine — nothing here inspects value).
func buildRawTx(outputScripts [][]byte) string {
	return buildRawTxWithScriptSig(nil, outputScripts)
}

// buildRawTxWithScriptSig is buildRawTx, but the one input's scriptSig is
// scriptSig instead of empty.
func buildRawTxWithScriptSig(scriptSig []byte, outputScripts [][]byte) string {
	var buf bytes.Buffer
	binary.Write(&buf, binary.LittleEndian, uint32(1)) // version

	writeVarInt(&buf, 1)                               // one input
	buf.Write(bytes.Repeat([]byte{0x11}, 32))          // prev txid
	binary.Write(&buf, binary.LittleEndian, uint32(0)) // prev index
	writeVarInt(&buf, uint64(len(scriptSig)))
	buf.Write(scriptSig)
	binary.Write(&buf, binary.LittleEndian, uint32(0xffffffff))

	writeVarInt(&buf, uint64(len(outputScripts)))
	for _, script := range outputScripts {
		binary.Write(&buf, binary.LittleEndian, uint64(0)) // value
		writeVarInt(&buf, uint64(len(script)))
		buf.Write(script)
	}

	binary.Write(&buf, binary.LittleEndian, uint32(0)) // locktime
	return hex.EncodeToString(buf.Bytes())
}

func TestParseTransactionOutputs(t *testing.T) {
	recordScript := buildRecordScript(1, []byte(`{"kind":"msg"}`))
	p2pkhScript := buildP2PKHScript()
	rawTx := buildRawTx([][]byte{recordScript, p2pkhScript})

	outputs, err := ParseTransactionOutputs(rawTx)
	if err != nil {
		t.Fatalf("ParseTransactionOutputs: %v", err)
	}
	if len(outputs) != 2 {
		t.Fatalf("len(outputs) = %d, want 2", len(outputs))
	}
	if outputs[0].Vout != 0 || outputs[1].Vout != 1 {
		t.Fatalf("vouts = %d, %d, want 0, 1", outputs[0].Vout, outputs[1].Vout)
	}
	if outputs[0].ScriptHex != hex.EncodeToString(recordScript) {
		t.Fatalf("outputs[0].ScriptHex = %q, want %q", outputs[0].ScriptHex, hex.EncodeToString(recordScript))
	}
	if outputs[1].ScriptHex != hex.EncodeToString(p2pkhScript) {
		t.Fatalf("outputs[1].ScriptHex = %q, want %q", outputs[1].ScriptHex, hex.EncodeToString(p2pkhScript))
	}
}

func TestParseTransactionOutputsInvalidHex(t *testing.T) {
	if _, err := ParseTransactionOutputs("not-hex"); err == nil {
		t.Fatal("expected an error for invalid hex, got nil")
	}
}

func TestDecodeScriptVersion1WithJSONPayload(t *testing.T) {
	payload := []byte(`{"kind":"msg","ciphertext":"abc","ts":"2026-09-24T12:00:00.000Z"}`)
	script := buildRecordScript(1, payload)

	decoded, ok := DecodeScript(hex.EncodeToString(script))
	if !ok {
		t.Fatal("DecodeScript returned ok=false for a valid record script")
	}
	if decoded.Version != 1 {
		t.Fatalf("Version = %d, want 1", decoded.Version)
	}
	if decoded.Payload == nil {
		t.Fatal("Payload is nil, want the parsed JSON payload")
	}
	if string(decoded.Payload) != string(payload) {
		t.Fatalf("Payload = %s, want %s", decoded.Payload, payload)
	}
}

func TestDecodeScriptNonJSONVersion1Payload(t *testing.T) {
	script := buildRecordScript(1, []byte("not json"))

	decoded, ok := DecodeScript(hex.EncodeToString(script))
	if !ok {
		t.Fatal("DecodeScript returned ok=false for a record script with a non-JSON payload")
	}
	if decoded.Payload != nil {
		t.Fatalf("Payload = %s, want nil for unparseable payload", decoded.Payload)
	}
}

func TestDecodeScriptOtherVersionHasNoPayload(t *testing.T) {
	script := buildRecordScript(2, []byte(`{"kind":"mint"}`))

	decoded, ok := DecodeScript(hex.EncodeToString(script))
	if !ok {
		t.Fatal("DecodeScript returned ok=false for a version-2 record script")
	}
	if decoded.Version != 2 {
		t.Fatalf("Version = %d, want 2", decoded.Version)
	}
	if decoded.Payload != nil {
		t.Fatalf("Payload = %s, want nil (only version 1 is decoded)", decoded.Payload)
	}
}

func TestDecodeScriptNotARecord(t *testing.T) {
	script := buildP2PKHScript()

	if _, ok := DecodeScript(hex.EncodeToString(script)); ok {
		t.Fatal("DecodeScript returned ok=true for a plain P2PKH script")
	}
}

func TestDecodeScriptWrongProtocolID(t *testing.T) {
	var script []byte
	script = append(script, 0x00, 0x6a)
	script = append(script, pushData([]byte("othertag"))...)
	script = append(script, pushData([]byte{1})...)
	script = append(script, pushData([]byte("{}"))...)

	if _, ok := DecodeScript(hex.EncodeToString(script)); ok {
		t.Fatal("DecodeScript returned ok=true for a non-nftgate protocol id")
	}
}

func TestDecodeScriptInvalidHex(t *testing.T) {
	if _, ok := DecodeScript("zz"); ok {
		t.Fatal("DecodeScript returned ok=true for invalid hex")
	}
}

// buildTypedRecordScript builds OP_FALSE OP_RETURN <'nftgate'> <0x02> <recordType>
// <manifest> <payload>, the format spell-forge-bsv's encodeTypedRecordScript writes.
func buildTypedRecordScript(recordType string, manifest []byte, payload []byte) []byte {
	var script []byte
	script = append(script, 0x00, 0x6a) // OP_FALSE OP_RETURN
	script = append(script, pushData([]byte("nftgate"))...)
	script = append(script, pushData([]byte{VersionTyped})...)
	script = append(script, pushData([]byte(recordType))...)
	if manifest != nil {
		script = append(script, pushData(manifest)...)
	}
	script = append(script, pushData(payload)...)
	return script
}

func TestDecodeTypedScriptMintRecordWithManifest(t *testing.T) {
	payload := []byte(`{"collection":"spellforge-leaderboard-testnet","holder":"mzzz"}`)
	script := buildTypedRecordScript("M", []byte{0x00}, payload)

	decoded, ok := DecodeTypedScript(hex.EncodeToString(script))
	if !ok {
		t.Fatal("DecodeTypedScript returned ok=false for a valid type-M record")
	}
	if decoded.Version != VersionTyped {
		t.Fatalf("Version = %d, want %d", decoded.Version, VersionTyped)
	}
	if decoded.RecordType != "M" {
		t.Fatalf("RecordType = %q, want M", decoded.RecordType)
	}
	if string(decoded.PayloadBytes) != string(payload) {
		t.Fatalf("PayloadBytes = %s, want %s", decoded.PayloadBytes, payload)
	}
}

func TestDecodeTypedScriptTransferRecordWithoutManifest(t *testing.T) {
	payload := []byte(`{"origin":"abc:0","to":"mzzz"}`)
	script := buildTypedRecordScript("TR", nil, payload)

	decoded, ok := DecodeTypedScript(hex.EncodeToString(script))
	if !ok {
		t.Fatal("DecodeTypedScript returned ok=false for a valid type-TR record with no manifest push")
	}
	if decoded.RecordType != "TR" {
		t.Fatalf("RecordType = %q, want TR", decoded.RecordType)
	}
	if string(decoded.PayloadBytes) != string(payload) {
		t.Fatalf("PayloadBytes = %s, want %s", decoded.PayloadBytes, payload)
	}
}

// buildGatedRecordScript builds spell-forge's 6-push layout (mw-jeswf.3):
// OP_FALSE OP_RETURN <'nftgate'> <0x02> <recordType> <commitment>
// <empty manifest 0x00> <payload>.
func buildGatedRecordScript(recordType string, commitment []byte, payload []byte) []byte {
	var script []byte
	script = append(script, 0x00, 0x6a) // OP_FALSE OP_RETURN
	script = append(script, pushData([]byte("nftgate"))...)
	script = append(script, pushData([]byte{VersionTyped})...)
	script = append(script, pushData([]byte(recordType))...)
	script = append(script, pushData(commitment)...)
	script = append(script, pushData([]byte{0x00})...)
	script = append(script, pushData(payload)...)
	return script
}

func TestDecodeTypedScriptReadsTheSixPushGatedLayout(t *testing.T) {
	commitment := bytes.Repeat([]byte{0xc0}, 32)
	for _, tc := range []struct {
		recordType string
		payload    []byte
	}{
		{"M", []byte(`{"collection":"sf","holder":"mzzz","wrapKey":"04","wrap":"01"}`)},
		{"W", []byte{0x9a, 0x01, 0xfe, 0x33}}, // a gated W's payload is ciphertext
		{"TR", []byte(`{"to":"mzzz"}`)},
	} {
		decoded, ok := DecodeTypedScript(hex.EncodeToString(buildGatedRecordScript(tc.recordType, commitment, tc.payload)))
		if !ok {
			t.Fatalf("DecodeTypedScript returned ok=false for a 6-push %s record", tc.recordType)
		}
		if decoded.RecordType != tc.recordType {
			t.Fatalf("RecordType = %q, want %q", decoded.RecordType, tc.recordType)
		}
		if !bytes.Equal(decoded.PayloadBytes, tc.payload) {
			t.Fatalf("%s PayloadBytes = %x, want the last push %x", tc.recordType, decoded.PayloadBytes, tc.payload)
		}
	}
}

func TestDecodeTypedScriptRefusesASixPushRecordWhoseCommitmentIsNot32Bytes(t *testing.T) {
	for _, size := range []int{0, 1, 31, 33} {
		script := buildGatedRecordScript("M", bytes.Repeat([]byte{0xc0}, size), []byte(`{"collection":"c","holder":"h"}`))
		if _, ok := DecodeTypedScript(hex.EncodeToString(script)); ok {
			t.Fatalf("DecodeTypedScript returned ok=true for a 6-push record with a %d-byte 4th push, want 32 only", size)
		}
	}
}

func TestDecodeTypedScriptRefusesSevenPushes(t *testing.T) {
	script := buildGatedRecordScript("M", bytes.Repeat([]byte{0xc0}, 32), []byte(`{}`))
	script = append(script, pushData([]byte(`{}`))...)
	if _, ok := DecodeTypedScript(hex.EncodeToString(script)); ok {
		t.Fatal("DecodeTypedScript returned ok=true for 7 pushes")
	}
}

func TestDecodeTypedScriptUnknownRecordType(t *testing.T) {
	script := buildTypedRecordScript("X", []byte{0x00}, []byte(`{}`))

	if _, ok := DecodeTypedScript(hex.EncodeToString(script)); ok {
		t.Fatal("DecodeTypedScript returned ok=true for an unrecognized record type")
	}
}

func TestDecodeTypedScriptRejectsPlaintextVersion(t *testing.T) {
	script := buildRecordScript(1, []byte(`{"kind":"msg"}`))

	if _, ok := DecodeTypedScript(hex.EncodeToString(script)); ok {
		t.Fatal("DecodeTypedScript returned ok=true for a version-1 (plaintext) record")
	}
}

func TestDecodeTypedScriptNotARecord(t *testing.T) {
	if _, ok := DecodeTypedScript(hex.EncodeToString(buildP2PKHScript())); ok {
		t.Fatal("DecodeTypedScript returned ok=true for a plain P2PKH script")
	}
}

func TestDecodeTypedScriptInvalidHex(t *testing.T) {
	if _, ok := DecodeTypedScript("zz"); ok {
		t.Fatal("DecodeTypedScript returned ok=true for invalid hex")
	}
}

// buildP2PKHScriptSig builds a standard <sig> <pubkey> unlocking script (the
// signature isn't cryptographically valid, but the shape is what
// ExtractSignerPublicKey inspects).
func buildP2PKHScriptSig(pubKey []byte) []byte {
	sig := bytes.Repeat([]byte{0x30}, 71) // a plausible DER signature length
	var script []byte
	script = append(script, pushData(sig)...)
	script = append(script, pushData(pubKey)...)
	return script
}

func TestExtractSignerPublicKeyCompressedKey(t *testing.T) {
	pubKey := append([]byte{0x02}, bytes.Repeat([]byte{0xcd}, 32)...)
	rawTx := buildRawTxWithScriptSig(buildP2PKHScriptSig(pubKey), [][]byte{buildP2PKHScript()})

	signer, ok := ExtractSignerPublicKey(rawTx)
	if !ok {
		t.Fatal("ExtractSignerPublicKey returned ok=false for a valid P2PKH scriptSig")
	}
	if signer != hex.EncodeToString(pubKey) {
		t.Fatalf("signer = %q, want %q", signer, hex.EncodeToString(pubKey))
	}
}

func TestExtractSignerPublicKeyUncompressedKey(t *testing.T) {
	pubKey := append([]byte{0x04}, bytes.Repeat([]byte{0xab}, 64)...)
	rawTx := buildRawTxWithScriptSig(buildP2PKHScriptSig(pubKey), [][]byte{buildP2PKHScript()})

	signer, ok := ExtractSignerPublicKey(rawTx)
	if !ok {
		t.Fatal("ExtractSignerPublicKey returned ok=false for a valid uncompressed-key scriptSig")
	}
	if signer != hex.EncodeToString(pubKey) {
		t.Fatalf("signer = %q, want %q", signer, hex.EncodeToString(pubKey))
	}
}

func TestExtractSignerPublicKeyEmptyScriptSig(t *testing.T) {
	rawTx := buildRawTx([][]byte{buildP2PKHScript()})

	if _, ok := ExtractSignerPublicKey(rawTx); ok {
		t.Fatal("ExtractSignerPublicKey returned ok=true for an empty scriptSig")
	}
}

func TestExtractSignerPublicKeyWrongPushCount(t *testing.T) {
	scriptSig := pushData(bytes.Repeat([]byte{0x30}, 10)) // just one push, no pubkey
	rawTx := buildRawTxWithScriptSig(scriptSig, [][]byte{buildP2PKHScript()})

	if _, ok := ExtractSignerPublicKey(rawTx); ok {
		t.Fatal("ExtractSignerPublicKey returned ok=true for a scriptSig with only one push")
	}
}

func TestExtractSignerPublicKeyBadKeyLength(t *testing.T) {
	scriptSig := buildP2PKHScriptSig(bytes.Repeat([]byte{0xcd}, 20)) // not 33 or 65 bytes
	rawTx := buildRawTxWithScriptSig(scriptSig, [][]byte{buildP2PKHScript()})

	if _, ok := ExtractSignerPublicKey(rawTx); ok {
		t.Fatal("ExtractSignerPublicKey returned ok=true for a push that isn't pubkey-shaped")
	}
}

func TestExtractSignerPublicKeyInvalidHex(t *testing.T) {
	if _, ok := ExtractSignerPublicKey("not-hex"); ok {
		t.Fatal("ExtractSignerPublicKey returned ok=true for invalid hex")
	}
}

// buildRawTxWithInputs builds a serialized transaction whose inputs spend
// the given outpoints (txid in display order, as a txid is written
// everywhere but inside the transaction) with the given scriptSigs.
func buildRawTxWithInputs(inputs []testInput, outputScripts [][]byte) string {
	var buf bytes.Buffer
	binary.Write(&buf, binary.LittleEndian, uint32(1))

	writeVarInt(&buf, uint64(len(inputs)))
	for _, in := range inputs {
		prev, err := hex.DecodeString(in.prevTxID)
		if err != nil {
			panic(err)
		}
		for i, j := 0, len(prev)-1; i < j; i, j = i+1, j-1 {
			prev[i], prev[j] = prev[j], prev[i]
		}
		buf.Write(prev)
		binary.Write(&buf, binary.LittleEndian, in.prevVout)
		writeVarInt(&buf, uint64(len(in.scriptSig)))
		buf.Write(in.scriptSig)
		binary.Write(&buf, binary.LittleEndian, uint32(0xffffffff))
	}

	writeVarInt(&buf, uint64(len(outputScripts)))
	for _, script := range outputScripts {
		binary.Write(&buf, binary.LittleEndian, uint64(0))
		writeVarInt(&buf, uint64(len(script)))
		buf.Write(script)
	}
	binary.Write(&buf, binary.LittleEndian, uint32(0))
	return hex.EncodeToString(buf.Bytes())
}

type testInput struct {
	prevTxID  string
	prevVout  uint32
	scriptSig []byte
}

func TestParseTransactionReadsInputsAndOutputs(t *testing.T) {
	pubKey := append([]byte{0x03}, bytes.Repeat([]byte{0xcd}, 32)...)
	prevA := "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
	prevB := strings.Repeat("ab", 32)
	record := buildRecordScript(1, []byte(`{"kind":"msg"}`))
	rawTx := buildRawTxWithInputs([]testInput{
		{prevTxID: prevA, prevVout: 0, scriptSig: []byte{0x01, 0x51}},
		{prevTxID: prevB, prevVout: 3, scriptSig: buildP2PKHScriptSig(pubKey)},
	}, [][]byte{record, buildP2PKHScript()})

	tx, err := ParseTransaction(rawTx)
	if err != nil {
		t.Fatalf("ParseTransaction: %v", err)
	}
	if len(tx.Inputs) != 2 {
		t.Fatalf("len(Inputs) = %d, want 2", len(tx.Inputs))
	}
	if tx.Inputs[0].PrevTxID != prevA || tx.Inputs[0].PrevVout != 0 {
		t.Fatalf("Inputs[0] spends %s:%d, want %s:0", tx.Inputs[0].PrevTxID, tx.Inputs[0].PrevVout, prevA)
	}
	if tx.Inputs[1].PrevTxID != prevB || tx.Inputs[1].PrevVout != 3 {
		t.Fatalf("Inputs[1] spends %s:%d, want %s:3", tx.Inputs[1].PrevTxID, tx.Inputs[1].PrevVout, prevB)
	}
	if got, ok := P2PKHPublicKey(tx.Inputs[1].ScriptSig); !ok || got != hex.EncodeToString(pubKey) {
		t.Fatalf("P2PKHPublicKey(Inputs[1]) = %q, %v, want the pushed key", got, ok)
	}
	if _, ok := P2PKHPublicKey(tx.Inputs[0].ScriptSig); ok {
		t.Fatal("P2PKHPublicKey accepted a one-push scriptSig")
	}
	if len(tx.Outputs) != 2 || tx.Outputs[0].ScriptHex != hex.EncodeToString(record) {
		t.Fatalf("Outputs = %+v, want the record then the P2PKH", tx.Outputs)
	}
}

func TestParseTransactionRejectsTruncatedHex(t *testing.T) {
	rawTx := buildRawTx([][]byte{buildP2PKHScript()})
	if _, err := ParseTransaction(rawTx[:len(rawTx)-20]); err == nil {
		t.Fatal("ParseTransaction accepted a truncated transaction")
	}
}

func TestP2PKHLockHashReadsTheHashOfAStandardP2PKHScript(t *testing.T) {
	hash, ok := P2PKHLockHash(hex.EncodeToString(buildP2PKHScript()))
	if !ok || !bytes.Equal(hash, bytes.Repeat([]byte{0xab}, 20)) {
		t.Fatalf("P2PKHLockHash = %x, %v, want the 20-byte hash", hash, ok)
	}
}

func TestP2PKHLockHashRejectsAnythingElse(t *testing.T) {
	p2pkh := buildP2PKHScript()
	for name, script := range map[string][]byte{
		"OP_2DROP OP_1":      {0x6d, 0x51},
		"empty":              {},
		"a record":           buildRecordScript(1, []byte(`{"kind":"msg"}`)),
		"trailing opcode":    append(append([]byte{}, p2pkh...), 0x75),
		"no OP_CHECKSIG":     p2pkh[:len(p2pkh)-1],
		"OP_CHECKSIGVERIFY":  append(append([]byte{}, p2pkh[:len(p2pkh)-1]...), 0xad),
		"a 21-byte hash":     append(append([]byte{0x76, 0xa9, 0x15}, bytes.Repeat([]byte{0xab}, 21)...), 0x88, 0xac),
		"OP_PUSHDATA1 20":    append(append([]byte{0x76, 0xa9, 0x4c, 0x14}, bytes.Repeat([]byte{0xab}, 20)...), 0x88, 0xac),
		"a prefix before it": append([]byte{0x51, 0x75}, p2pkh...),
	} {
		if hash, ok := P2PKHLockHash(hex.EncodeToString(script)); ok {
			t.Errorf("%s: P2PKHLockHash = %x, true, want ok=false", name, hash)
		}
	}
	if _, ok := P2PKHLockHash("zz"); ok {
		t.Error("P2PKHLockHash accepted invalid hex")
	}
}
