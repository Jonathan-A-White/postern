package licence

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"testing"

	"github.com/Jonathan-A-White/postern/server/internal/woc"
	"github.com/btcsuite/btcd/btcec/v2"
)

// writeVarInt writes a Bitcoin CompactSize integer.
func writeVarInt(buf *bytes.Buffer, n uint64) {
	switch {
	case n < 0xfd:
		buf.WriteByte(byte(n))
	default:
		panic("writeVarInt test helper only supports short counts")
	}
}

func pushData(data []byte) []byte {
	if len(data) < 0x4c {
		out := make([]byte, 0, len(data)+1)
		out = append(out, byte(len(data)))
		out = append(out, data...)
		return out
	}
	if len(data) > 0xff {
		panic("pushData test helper only supports pushes up to 255 bytes")
	}
	out := make([]byte, 0, len(data)+2)
	out = append(out, 0x4c, byte(len(data))) // OP_PUSHDATA1
	out = append(out, data...)
	return out
}

func typedRecordScript(recordType string, payload []byte) []byte {
	var script []byte
	script = append(script, 0x00, 0x6a) // OP_FALSE OP_RETURN
	script = append(script, pushData([]byte("nftgate"))...)
	script = append(script, pushData([]byte{0x02})...)
	script = append(script, pushData([]byte(recordType))...)
	script = append(script, pushData([]byte{0x00})...) // empty manifest
	script = append(script, pushData(payload)...)
	return script
}

func rawTxWithOutputs(outputScripts [][]byte) string {
	var buf bytes.Buffer
	binary.Write(&buf, binary.LittleEndian, uint32(1))
	writeVarInt(&buf, 1)
	buf.Write(bytes.Repeat([]byte{0x11}, 32))
	binary.Write(&buf, binary.LittleEndian, uint32(0))
	writeVarInt(&buf, 0)
	binary.Write(&buf, binary.LittleEndian, uint32(0xffffffff))

	writeVarInt(&buf, uint64(len(outputScripts)))
	for _, script := range outputScripts {
		binary.Write(&buf, binary.LittleEndian, uint64(0))
		writeVarInt(&buf, uint64(len(script)))
		buf.Write(script)
	}
	binary.Write(&buf, binary.LittleEndian, uint32(0))
	return hex.EncodeToString(buf.Bytes())
}

// fakeReader is a chain reader test double: address -> history, txid -> raw hex.
type fakeReader struct {
	history map[string][]woc.HistoryEntry
	txs     map[string]string
}

func (f *fakeReader) GetHistory(address string) ([]woc.HistoryEntry, error) {
	return f.history[address], nil
}

func (f *fakeReader) GetTransactionHex(txid string) (string, error) {
	return f.txs[txid], nil
}

const testAddress = "mzzzTestAddress0000000000000000000"

func TestHeldTrueForMintNamingTheAddress(t *testing.T) {
	payload := []byte(`{"collection":"` + CollectionID + `","holder":"` + testAddress + `"}`)
	mintTx := rawTxWithOutputs([][]byte{typedRecordScript("M", payload)})

	reader := &fakeReader{
		history: map[string][]woc.HistoryEntry{testAddress: {{TxHash: "mint1", Height: 100}}},
		txs:     map[string]string{"mint1": mintTx},
	}

	held, err := Held(reader, testAddress)
	if err != nil {
		t.Fatalf("Held: %v", err)
	}
	if !held {
		t.Fatal("held = false, want true")
	}
}

func TestHeldFalseWithNoMint(t *testing.T) {
	reader := &fakeReader{
		history: map[string][]woc.HistoryEntry{testAddress: {}},
		txs:     map[string]string{},
	}

	held, err := Held(reader, testAddress)
	if err != nil {
		t.Fatalf("Held: %v", err)
	}
	if held {
		t.Fatal("held = true, want false")
	}
}

func TestHeldFalseForMintOfADifferentCollection(t *testing.T) {
	payload := []byte(`{"collection":"some-other-collection","holder":"` + testAddress + `"}`)
	mintTx := rawTxWithOutputs([][]byte{typedRecordScript("M", payload)})

	reader := &fakeReader{
		history: map[string][]woc.HistoryEntry{testAddress: {{TxHash: "mint1", Height: 100}}},
		txs:     map[string]string{"mint1": mintTx},
	}

	held, err := Held(reader, testAddress)
	if err != nil {
		t.Fatalf("Held: %v", err)
	}
	if held {
		t.Fatal("held = true, want false for a different collection")
	}
}

func TestHeldFalseForMintNamingADifferentHolder(t *testing.T) {
	payload := []byte(`{"collection":"` + CollectionID + `","holder":"someoneElse"}`)
	mintTx := rawTxWithOutputs([][]byte{typedRecordScript("M", payload)})

	reader := &fakeReader{
		history: map[string][]woc.HistoryEntry{testAddress: {{TxHash: "mint1", Height: 100}}},
		txs:     map[string]string{"mint1": mintTx},
	}

	held, err := Held(reader, testAddress)
	if err != nil {
		t.Fatalf("Held: %v", err)
	}
	if held {
		t.Fatal("held = true, want false for a mint naming a different holder")
	}
}

func TestHeldFalseAfterATransferMovesTheMintAway(t *testing.T) {
	mintPayload := []byte(`{"collection":"` + CollectionID + `","holder":"` + testAddress + `"}`)
	mintTx := rawTxWithOutputs([][]byte{typedRecordScript("M", mintPayload)})
	transferPayload := []byte(`{"origin":"mint1:0","to":"someoneElse"}`)
	transferTx := rawTxWithOutputs([][]byte{typedRecordScript("TR", transferPayload)})

	reader := &fakeReader{
		history: map[string][]woc.HistoryEntry{
			testAddress: {{TxHash: "mint1", Height: 100}, {TxHash: "transfer1", Height: 200}},
		},
		txs: map[string]string{"mint1": mintTx, "transfer1": transferTx},
	}

	held, err := Held(reader, testAddress)
	if err != nil {
		t.Fatalf("Held: %v", err)
	}
	if held {
		t.Fatal("held = true, want false once the mint's origin has been transferred away")
	}
}

func TestAddressForPublicKeyIsStableAndTestnet(t *testing.T) {
	privKey, err := btcec.NewPrivateKey()
	if err != nil {
		t.Fatalf("btcec.NewPrivateKey: %v", err)
	}
	pubKeyHex := hex.EncodeToString(privKey.PubKey().SerializeCompressed())

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
