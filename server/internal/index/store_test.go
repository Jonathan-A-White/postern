package index

import (
	"encoding/json"
	"path/filepath"
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
