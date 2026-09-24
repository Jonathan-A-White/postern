package record

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
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
// and the given output scripts (each carrying 0 satoshis, which is fine —
// nothing here inspects value).
func buildRawTx(outputScripts [][]byte) string {
	var buf bytes.Buffer
	binary.Write(&buf, binary.LittleEndian, uint32(1)) // version

	writeVarInt(&buf, 1)                               // one input
	buf.Write(bytes.Repeat([]byte{0x11}, 32))          // prev txid
	binary.Write(&buf, binary.LittleEndian, uint32(0)) // prev index
	writeVarInt(&buf, 0)                               // empty scriptSig
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
