// Package record decodes the 'nftgate' OP_RETURN record framing used on the
// postern anchor address, and pulls output scripts out of a raw transaction.
// It never decrypts anything: a version-1 payload is stored as opaque JSON,
// ciphertext fields and all.
package record

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

// protocolID is the literal 'nftgate' tag every record script carries as its
// first push, right after OP_FALSE OP_RETURN.
var protocolID = []byte("nftgate")

const (
	opFalse  = 0x00
	opReturn = 0x6a

	opPushData1 = 0x4c
	opPushData2 = 0x4d
	opPushData4 = 0x4e
)

// VersionPlaintext is the only payload version this backend parses as JSON;
// other versions (e.g. the License app's typed 0x02 records) are still
// recognised as records but their payload is left nil.
const VersionPlaintext = 0x01

// Decoded is what a record-carrying output yields: its version byte, and —
// only for version 1 — the payload re-parsed as JSON, if it parses.
type Decoded struct {
	Version byte
	Payload json.RawMessage
}

// DecodeScript parses a locking script (as hex) as OP_FALSE OP_RETURN
// <'nftgate'> <version> <payload>. It reports ok=false for anything that
// doesn't match that shape — a P2PKH output, a foreign OP_RETURN, bad hex,
// and so on.
func DecodeScript(scriptHex string) (*Decoded, bool) {
	scriptBytes, err := hex.DecodeString(scriptHex)
	if err != nil {
		return nil, false
	}

	if len(scriptBytes) < 2 || scriptBytes[0] != opFalse || scriptBytes[1] != opReturn {
		return nil, false
	}

	pushes, ok := parsePushDataSequence(scriptBytes[2:])
	if !ok || len(pushes) != 3 {
		return nil, false
	}

	protocol, versionBytes, payloadBytes := pushes[0], pushes[1], pushes[2]
	if !bytes.Equal(protocol, protocolID) {
		return nil, false
	}
	if len(versionBytes) != 1 {
		return nil, false
	}

	decoded := &Decoded{Version: versionBytes[0]}
	if decoded.Version == VersionPlaintext && json.Valid(payloadBytes) {
		decoded.Payload = json.RawMessage(payloadBytes)
	}
	return decoded, true
}

// parsePushDataSequence splits a byte string into the pushes a standard
// pushdata sequence (literal-length, OP_PUSHDATA1/2/4) encodes. It reports
// ok=false if any opcode isn't a push, or a declared length runs past the
// end of the input.
func parsePushDataSequence(data []byte) ([][]byte, bool) {
	var pushes [][]byte
	i := 0

	for i < len(data) {
		op := data[i]
		i++

		var length int
		switch {
		case op < opPushData1:
			length = int(op)
		case op == opPushData1:
			if i+1 > len(data) {
				return nil, false
			}
			length = int(data[i])
			i++
		case op == opPushData2:
			if i+2 > len(data) {
				return nil, false
			}
			length = int(binary.LittleEndian.Uint16(data[i : i+2]))
			i += 2
		case op == opPushData4:
			if i+4 > len(data) {
				return nil, false
			}
			length = int(binary.LittleEndian.Uint32(data[i : i+4]))
			i += 4
		default:
			return nil, false
		}

		if i+length > len(data) {
			return nil, false
		}
		pushes = append(pushes, data[i:i+length])
		i += length
	}

	return pushes, true
}

// VersionTyped is the License app's typed record format (spec §3.8): OP_FALSE
// OP_RETURN <'nftgate'> <0x02> <record type> [<value manifest>] <payload>.
// Only the record types findLicence needs to read are recognised.
const VersionTyped = 0x02

var typedRecordTypes = map[string]bool{"M": true, "W": true, "TR": true}

// TypedDecoded is a decoded typed (version 0x02) record: its record type
// ('M', 'W', or 'TR') and opaque payload bytes.
type TypedDecoded struct {
	Version      byte
	RecordType   string
	PayloadBytes []byte
}

// DecodeTypedScript parses a locking script (as hex) as a version-0x02
// nftgate record: OP_FALSE OP_RETURN <'nftgate'> <0x02> <record type>
// <payload>, with an optional value-manifest push between the record type
// and the payload (spell-forge-bsv's encodeTypedRecordScript writes 5 pushes
// once a manifest exists, 4 before it did; both are accepted, and the
// payload is always the last push). It reports ok=false for anything else,
// including a version-1 (plaintext) record.
func DecodeTypedScript(scriptHex string) (*TypedDecoded, bool) {
	scriptBytes, err := hex.DecodeString(scriptHex)
	if err != nil {
		return nil, false
	}

	if len(scriptBytes) < 2 || scriptBytes[0] != opFalse || scriptBytes[1] != opReturn {
		return nil, false
	}

	pushes, ok := parsePushDataSequence(scriptBytes[2:])
	if !ok || (len(pushes) != 4 && len(pushes) != 5) {
		return nil, false
	}

	protocol, versionBytes, typeBytes := pushes[0], pushes[1], pushes[2]
	if !bytes.Equal(protocol, protocolID) {
		return nil, false
	}
	if len(versionBytes) != 1 || versionBytes[0] != VersionTyped {
		return nil, false
	}

	recordType := string(typeBytes)
	if !typedRecordTypes[recordType] {
		return nil, false
	}

	payloadBytes := pushes[len(pushes)-1]
	return &TypedDecoded{Version: versionBytes[0], RecordType: recordType, PayloadBytes: payloadBytes}, true
}

// Output is one output of a parsed transaction: its index and locking
// script (as hex, ready to feed back into DecodeScript).
type Output struct {
	Vout      int
	ScriptHex string
}

// ParseTransactionOutputs deserializes a raw legacy-format transaction (as
// hex) far enough to recover every output's index and locking script. It
// does not need input or witness data, so it doesn't validate or interpret
// them beyond skipping past them.
func ParseTransactionOutputs(rawTxHex string) ([]Output, error) {
	raw, err := hex.DecodeString(rawTxHex)
	if err != nil {
		return nil, fmt.Errorf("decoding tx hex: %w", err)
	}

	r := &byteReader{data: raw}

	if _, err := r.readUint32(); err != nil { // version
		return nil, fmt.Errorf("reading version: %w", err)
	}

	inputCount, err := r.readVarInt()
	if err != nil {
		return nil, fmt.Errorf("reading input count: %w", err)
	}
	for n := uint64(0); n < inputCount; n++ {
		if err := r.skip(32 + 4); err != nil { // prev txid + prev index
			return nil, fmt.Errorf("reading input %d: %w", n, err)
		}
		scriptSigLen, err := r.readVarInt()
		if err != nil {
			return nil, fmt.Errorf("reading input %d scriptSig length: %w", n, err)
		}
		if err := r.skip(int(scriptSigLen)); err != nil {
			return nil, fmt.Errorf("reading input %d scriptSig: %w", n, err)
		}
		if err := r.skip(4); err != nil { // sequence
			return nil, fmt.Errorf("reading input %d sequence: %w", n, err)
		}
	}

	outputCount, err := r.readVarInt()
	if err != nil {
		return nil, fmt.Errorf("reading output count: %w", err)
	}
	outputs := make([]Output, 0, outputCount)
	for n := uint64(0); n < outputCount; n++ {
		if err := r.skip(8); err != nil { // value
			return nil, fmt.Errorf("reading output %d value: %w", n, err)
		}
		scriptLen, err := r.readVarInt()
		if err != nil {
			return nil, fmt.Errorf("reading output %d script length: %w", n, err)
		}
		script, err := r.read(int(scriptLen))
		if err != nil {
			return nil, fmt.Errorf("reading output %d script: %w", n, err)
		}
		outputs = append(outputs, Output{Vout: int(n), ScriptHex: hex.EncodeToString(script)})
	}

	return outputs, nil
}

// ExtractSignerPublicKey returns the hex-encoded public key from the raw
// transaction's first input's scriptSig — the second push of the standard
// P2PKH unlocking script <sig> <pubkey> — reporting ok=false if the
// transaction has no inputs, or that input's scriptSig isn't shaped that
// way (not exactly two pushes, or the second push isn't a compressed (33
// byte) or uncompressed (65 byte) SEC public key).
func ExtractSignerPublicKey(rawTxHex string) (string, bool) {
	raw, err := hex.DecodeString(rawTxHex)
	if err != nil {
		return "", false
	}

	r := &byteReader{data: raw}

	if _, err := r.readUint32(); err != nil { // version
		return "", false
	}

	inputCount, err := r.readVarInt()
	if err != nil || inputCount == 0 {
		return "", false
	}

	if err := r.skip(32 + 4); err != nil { // prev txid + prev index
		return "", false
	}
	scriptSigLen, err := r.readVarInt()
	if err != nil {
		return "", false
	}
	scriptSig, err := r.read(int(scriptSigLen))
	if err != nil {
		return "", false
	}

	pushes, ok := parsePushDataSequence(scriptSig)
	if !ok || len(pushes) != 2 {
		return "", false
	}

	pubKey := pushes[1]
	if len(pubKey) != 33 && len(pubKey) != 65 {
		return "", false
	}

	return hex.EncodeToString(pubKey), true
}

// byteReader is a minimal forward-only cursor over a raw transaction's
// bytes, with the CompactSize varint decoding transactions use throughout.
type byteReader struct {
	data []byte
	pos  int
}

func (r *byteReader) read(n int) ([]byte, error) {
	if n < 0 || r.pos+n > len(r.data) {
		return nil, fmt.Errorf("unexpected end of data")
	}
	out := r.data[r.pos : r.pos+n]
	r.pos += n
	return out, nil
}

func (r *byteReader) skip(n int) error {
	_, err := r.read(n)
	return err
}

func (r *byteReader) readUint32() (uint32, error) {
	b, err := r.read(4)
	if err != nil {
		return 0, err
	}
	return binary.LittleEndian.Uint32(b), nil
}

func (r *byteReader) readVarInt() (uint64, error) {
	prefix, err := r.read(1)
	if err != nil {
		return 0, err
	}
	switch prefix[0] {
	case 0xfd:
		b, err := r.read(2)
		if err != nil {
			return 0, err
		}
		return uint64(binary.LittleEndian.Uint16(b)), nil
	case 0xfe:
		b, err := r.read(4)
		if err != nil {
			return 0, err
		}
		return uint64(binary.LittleEndian.Uint32(b)), nil
	case 0xff:
		b, err := r.read(8)
		if err != nil {
			return 0, err
		}
		return binary.LittleEndian.Uint64(b), nil
	default:
		return uint64(prefix[0]), nil
	}
}
