package index

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newRecord(txid string, vout int) Record {
	return Record{
		TxID:      txid,
		Vout:      vout,
		ScriptHex: "00",
		Height:    100,
		FirstSeen: time.Date(2026, 9, 24, 12, 0, 0, 0, time.UTC),
		Payload:   json.RawMessage(`{"kind":"msg"}`),
	}
}

func TestAppendAssignsSequenceNumbers(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()

	first, err := store.Append(newRecord("tx1", 0))
	if err != nil {
		t.Fatalf("Append: %v", err)
	}
	second, err := store.Append(newRecord("tx2", 0))
	if err != nil {
		t.Fatalf("Append: %v", err)
	}

	if first.Seq != 1 {
		t.Fatalf("first.Seq = %d, want 1", first.Seq)
	}
	if second.Seq != 2 {
		t.Fatalf("second.Seq = %d, want 2", second.Seq)
	}
}

func TestSinceReturnsOnlyLaterRecordsAndNextSeq(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()

	store.Append(newRecord("tx1", 0))
	store.Append(newRecord("tx2", 0))
	store.Append(newRecord("tx3", 0))

	records, next := store.Since(1)
	if len(records) != 2 {
		t.Fatalf("len(records) = %d, want 2", len(records))
	}
	if records[0].TxID != "tx2" || records[1].TxID != "tx3" {
		t.Fatalf("records = %v, want tx2, tx3", records)
	}
	if next != 3 {
		t.Fatalf("next = %d, want 3", next)
	}
}

func TestSinceZeroReturnsEverythingOldestFirst(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()

	store.Append(newRecord("tx1", 0))
	store.Append(newRecord("tx2", 0))

	records, next := store.Since(0)
	if len(records) != 2 {
		t.Fatalf("len(records) = %d, want 2", len(records))
	}
	if records[0].TxID != "tx1" {
		t.Fatalf("records[0].TxID = %q, want tx1 (oldest first)", records[0].TxID)
	}
	if next != 2 {
		t.Fatalf("next = %d, want 2", next)
	}
}

func TestSinceAtHeadReturnsNoRecordsAndCurrentHead(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()

	store.Append(newRecord("tx1", 0))

	records, next := store.Since(1)
	if len(records) != 0 {
		t.Fatalf("len(records) = %d, want 0", len(records))
	}
	if next != 1 {
		t.Fatalf("next = %d, want 1", next)
	}
}

func TestSeenTx(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()

	if store.SeenTx("tx1") {
		t.Fatal("SeenTx(tx1) = true before it was ever marked")
	}
	store.MarkSeen("tx1")
	if !store.SeenTx("tx1") {
		t.Fatal("SeenTx(tx1) = false after MarkSeen")
	}

	store.Append(newRecord("tx2", 0))
	if !store.SeenTx("tx2") {
		t.Fatal("SeenTx(tx2) = false after Append — Append should mark its txid seen too")
	}
}

func TestIndexSurvivesRestart(t *testing.T) {
	dir := t.TempDir()

	store, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	store.Append(newRecord("tx1", 0))
	store.Append(newRecord("tx1", 1))
	store.Append(newRecord("tx2", 0))
	if err := store.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	reopened, err := Open(dir)
	if err != nil {
		t.Fatalf("Open (reload): %v", err)
	}
	defer reopened.Close()

	records, next := reopened.Since(0)
	if len(records) != 3 {
		t.Fatalf("len(records) = %d, want 3", len(records))
	}
	if next != 3 {
		t.Fatalf("next = %d, want 3", next)
	}
	if !reopened.SeenTx("tx1") || !reopened.SeenTx("tx2") {
		t.Fatal("reloaded store should mark every replayed txid seen")
	}

	// A fourth record appended after reload continues the sequence rather
	// than restarting it.
	fourth, err := reopened.Append(newRecord("tx3", 0))
	if err != nil {
		t.Fatalf("Append after reload: %v", err)
	}
	if fourth.Seq != 4 {
		t.Fatalf("fourth.Seq = %d, want 4 (continuing after replay)", fourth.Seq)
	}
}

func TestOpenCreatesDataDirectory(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "nested", "data")

	store, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()

	if _, err := store.Append(newRecord("tx1", 0)); err != nil {
		t.Fatalf("Append: %v", err)
	}
}

func directRecord(id string) Record {
	return Record{
		TxID:      id,
		ScriptHex: "006a",
		FirstSeen: time.Date(2026, 9, 28, 12, 0, 0, 0, time.UTC),
		Payload:   json.RawMessage(`{"kind":"msg"}`),
		Signer:    "02aa",
	}
}

// wantChain is sha256(prev || id), hex, with prev the previous chain decoded
// from hex (64 zeros for the first direct record).
func wantChain(t *testing.T, prevHex, id string) string {
	t.Helper()
	prev, err := hex.DecodeString(prevHex)
	if err != nil {
		t.Fatalf("decoding prev chain: %v", err)
	}
	sum := sha256.Sum256(append(prev, []byte(id)...))
	return hex.EncodeToString(sum[:])
}

var zeroChain = strings.Repeat("0", 64)

func TestAppendDirectChainsEveryDirectRecordInOrder(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()

	first, created, err := store.AppendDirect(directRecord("direct:aa"))
	if err != nil || !created {
		t.Fatalf("AppendDirect: created=%v err=%v, want a new record", created, err)
	}
	if first.Chain != wantChain(t, zeroChain, "direct:aa") {
		t.Fatalf("first.Chain = %q, want sha256(32 zero bytes || id)", first.Chain)
	}

	// A chain record in between is not part of the direct chain.
	if _, err := store.Append(newRecord("tx1", 0)); err != nil {
		t.Fatalf("Append: %v", err)
	}

	second, _, err := store.AppendDirect(directRecord("direct:bb"))
	if err != nil {
		t.Fatalf("AppendDirect: %v", err)
	}
	if second.Seq != 3 {
		t.Fatalf("second.Seq = %d, want 3", second.Seq)
	}
	if second.Chain != wantChain(t, first.Chain, "direct:bb") {
		t.Fatalf("second.Chain = %q, want sha256(first.Chain || id)", second.Chain)
	}

	records, _ := store.Since(0)
	if records[1].Chain != "" {
		t.Fatalf("chain record carries Chain %q, want none", records[1].Chain)
	}
}

func TestAppendDirectIsIdempotentByTxID(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()

	first, _, err := store.AppendDirect(directRecord("direct:aa"))
	if err != nil {
		t.Fatalf("AppendDirect: %v", err)
	}
	again, created, err := store.AppendDirect(directRecord("direct:aa"))
	if err != nil {
		t.Fatalf("AppendDirect (repeat): %v", err)
	}
	if created {
		t.Fatal("created = true for a repeat, want false")
	}
	if again.Seq != first.Seq || again.Chain != first.Chain {
		t.Fatalf("repeat = seq %d chain %s, want the stored seq %d chain %s", again.Seq, again.Chain, first.Seq, first.Chain)
	}
	if records, head := store.Since(0); len(records) != 1 || head != 1 {
		t.Fatalf("records = %d, head = %d, want one record stored once", len(records), head)
	}

	// The chain did not advance for the repeat.
	next, _, err := store.AppendDirect(directRecord("direct:bb"))
	if err != nil {
		t.Fatalf("AppendDirect: %v", err)
	}
	if next.Chain != wantChain(t, first.Chain, "direct:bb") {
		t.Fatalf("next.Chain = %q, want it chained onto the first record only", next.Chain)
	}
}

func TestAppendDirectChainSurvivesRestart(t *testing.T) {
	dir := t.TempDir()
	store, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	first, _, err := store.AppendDirect(directRecord("direct:aa"))
	if err != nil {
		t.Fatalf("AppendDirect: %v", err)
	}
	store.Append(newRecord("tx1", 0))
	store.Close()

	reopened, err := Open(dir)
	if err != nil {
		t.Fatalf("Open (reload): %v", err)
	}
	defer reopened.Close()

	if _, created, _ := reopened.AppendDirect(directRecord("direct:aa")); created {
		t.Fatal("a replayed direct record was stored again after restart")
	}
	second, _, err := reopened.AppendDirect(directRecord("direct:bb"))
	if err != nil {
		t.Fatalf("AppendDirect after reload: %v", err)
	}
	if second.Chain != wantChain(t, first.Chain, "direct:bb") {
		t.Fatalf("second.Chain = %q, want it chained onto the replayed first record", second.Chain)
	}
}

func TestHeadIsTheLatestSequenceNumber(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()

	if store.Head() != 0 {
		t.Fatalf("Head() = %d on an empty index, want 0", store.Head())
	}
	store.Append(newRecord("tx1", 0))
	store.AppendDirect(directRecord("direct:aa"))
	if store.Head() != 2 {
		t.Fatalf("Head() = %d, want 2", store.Head())
	}
}

func TestSignerAppsSurviveRestart(t *testing.T) {
	dir := t.TempDir()
	store, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if _, _, err := store.AppendDirect(Record{TxID: "direct:aa", Signer: "02ab", SignerApps: []string{"cairn"}}); err != nil {
		t.Fatalf("AppendDirect: %v", err)
	}
	store.Close()

	reopened, err := Open(dir)
	if err != nil {
		t.Fatalf("Open (reopen): %v", err)
	}
	defer reopened.Close()
	records, _ := reopened.Since(0)
	if len(records) != 1 || len(records[0].SignerApps) != 1 || records[0].SignerApps[0] != "cairn" {
		t.Fatalf("records = %+v, want one record whose signer_apps is [cairn]", records)
	}
}
