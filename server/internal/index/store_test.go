package index

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"
	"strconv"
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

// writeIndex seeds dir with two whole records and returns the file's path
// and the bytes of those two lines.
func writeIndex(t *testing.T, dir string) (string, []byte) {
	t.Helper()
	store, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	store.Append(newRecord("tx1", 0))
	store.Append(newRecord("tx2", 0))
	if err := store.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	path := filepath.Join(dir, fileName)
	whole, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading index: %v", err)
	}
	return path, whole
}

func appendBytes(t *testing.T, path string, b []byte) {
	t.Helper()
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatalf("opening index: %v", err)
	}
	defer f.Close()
	if _, err := f.Write(b); err != nil {
		t.Fatalf("writing index: %v", err)
	}
}

func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	return &buf
}

func TestOpenTruncatesATornLastLine(t *testing.T) {
	dir := t.TempDir()
	path, whole := writeIndex(t, dir)
	appendBytes(t, path, []byte(`{"seq":3,"txid":"tx3","vout":0,"scri`))
	logged := captureLog(t)

	store, err := Open(dir)
	if err != nil {
		t.Fatalf("Open with a torn last line: %v", err)
	}
	defer store.Close()

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading index: %v", err)
	}
	if !bytes.Equal(got, whole) {
		t.Fatalf("file after Open = %q, want it cut back to the last whole line %q", got, whole)
	}
	lines := strings.Split(strings.TrimSpace(logged.String()), "\n")
	if len(lines) != 1 || lines[0] == "" {
		t.Fatalf("logged %d lines (%q), want exactly one", len(lines), logged.String())
	}
	if want := strconv.Itoa(len(whole)); !strings.Contains(lines[0], want) {
		t.Fatalf("log line %q does not name the byte offset %s", lines[0], want)
	}

	records, head := store.Since(0)
	if len(records) != 2 || head != 2 {
		t.Fatalf("got %d records, head %d; want the 2 whole records, head 2", len(records), head)
	}
	third, err := store.Append(newRecord("tx3", 0))
	if err != nil {
		t.Fatalf("Append after truncation: %v", err)
	}
	if third.Seq != 3 {
		t.Fatalf("third.Seq = %d, want 3", third.Seq)
	}
}

func TestOpenAfterTruncationReplaysEverythingAppendedSince(t *testing.T) {
	dir := t.TempDir()
	path, _ := writeIndex(t, dir)
	appendBytes(t, path, []byte(`{"seq":3,"tx`))
	captureLog(t)

	store, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	store.Append(newRecord("tx3", 0))
	store.Close()

	reopened, err := Open(dir)
	if err != nil {
		t.Fatalf("Open (reload): %v", err)
	}
	defer reopened.Close()
	if records, _ := reopened.Since(0); len(records) != 3 {
		t.Fatalf("len(records) = %d, want 3", len(records))
	}
}

func TestOpenKeepsAWholeLastRecordThatLacksItsNewline(t *testing.T) {
	dir := t.TempDir()
	path, whole := writeIndex(t, dir)
	line, err := json.Marshal(Record{Seq: 3, TxID: "tx3", ScriptHex: "00"})
	if err != nil {
		t.Fatal(err)
	}
	appendBytes(t, path, line) // crash after the record, before its newline
	logged := captureLog(t)

	store, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if logged.Len() != 0 {
		t.Fatalf("logged %q for a whole record, want nothing", logged.String())
	}
	if _, err := store.Append(newRecord("tx4", 0)); err != nil {
		t.Fatalf("Append: %v", err)
	}
	store.Close()

	reopened, err := Open(dir)
	if err != nil {
		t.Fatalf("Open (reload): %v", err)
	}
	defer reopened.Close()
	records, _ := reopened.Since(0)
	if len(records) != 4 {
		t.Fatalf("len(records) = %d, want 4 (the whole record kept, the new one on its own line)", len(records))
	}
	got, _ := os.ReadFile(path)
	if !bytes.HasPrefix(got, whole) {
		t.Fatalf("the first two lines changed: %q", got)
	}
}

func TestOpenRefusesAMalformedLineInTheMiddle(t *testing.T) {
	dir := t.TempDir()
	path, whole := writeIndex(t, dir)
	lines := bytes.SplitAfter(whole, []byte("\n"))
	broken := append([]byte{}, lines[0]...)
	broken = append(broken, []byte("{not json}\n")...)
	broken = append(broken, lines[1]...)
	if err := os.WriteFile(path, broken, 0o644); err != nil {
		t.Fatal(err)
	}

	if store, err := Open(dir); err == nil {
		store.Close()
		t.Fatal("Open succeeded over a malformed middle line, want an error")
	}
	got, _ := os.ReadFile(path)
	if !bytes.Equal(got, broken) {
		t.Fatal("a refused Open must leave the file as it was")
	}
}

func TestOpenRefusesAMalformedLastLineThatEndsInANewline(t *testing.T) {
	dir := t.TempDir()
	path, _ := writeIndex(t, dir)
	appendBytes(t, path, []byte("{not json}\n"))

	if store, err := Open(dir); err == nil {
		store.Close()
		t.Fatal("Open succeeded over a complete but malformed last line, want an error")
	}
}

func TestAFailedAppendLeavesTheFileReadableOnTheNextOpen(t *testing.T) {
	dir := t.TempDir()
	path, whole := writeIndex(t, dir)

	store, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	store.Close()
	if _, err := store.Append(newRecord("tx3", 0)); err == nil {
		t.Fatal("Append on a closed store succeeded, want an error")
	}
	got, _ := os.ReadFile(path)
	if !bytes.Equal(got, whole) {
		t.Fatalf("a failed Append changed the file: %q", got)
	}

	reopened, err := Open(dir)
	if err != nil {
		t.Fatalf("Open after a failed Append: %v", err)
	}
	defer reopened.Close()
	if records, _ := reopened.Since(0); len(records) != 2 {
		t.Fatalf("len(records) = %d, want 2", len(records))
	}
}

func TestAnAppendThatWritesPartAndFailsIsCutBack(t *testing.T) {
	dir := t.TempDir()
	path, whole := writeIndex(t, dir)
	store, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()

	store.afterWrite = func() error { return errors.New("disk full") }
	if _, err := store.Append(newRecord("tx3", 0)); err == nil {
		t.Fatal("Append succeeded though the sync failed")
	}
	got, _ := os.ReadFile(path)
	if !bytes.Equal(got, whole) {
		t.Fatalf("file after a failed Append = %q, want the partial line cut back to %q", got, whole)
	}
	if store.Head() != 2 {
		t.Fatalf("Head = %d after a failed Append, want 2", store.Head())
	}

	store.afterWrite = nil
	next, err := store.Append(newRecord("tx3", 0))
	if err != nil {
		t.Fatalf("Append after the failure: %v", err)
	}
	if next.Seq != 3 {
		t.Fatalf("next.Seq = %d, want 3", next.Seq)
	}
}

func TestSinceLimitPagesInOrderAndEndsAtTheHead(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()
	for _, id := range []string{"tx1", "tx2", "tx3", "tx4", "tx5"} {
		store.Append(newRecord(id, 0))
	}

	page, next, more := store.SinceLimit(0, 2)
	if len(page) != 2 || page[0].TxID != "tx1" || page[1].TxID != "tx2" {
		t.Fatalf("first page = %v, want tx1, tx2", page)
	}
	if next != 2 || !more {
		t.Fatalf("first page: next = %d, more = %v; want 2, true", next, more)
	}

	var drained []string
	cursor := uint64(0)
	for {
		page, next, more = store.SinceLimit(cursor, 2)
		for _, rec := range page {
			drained = append(drained, rec.TxID)
		}
		cursor = next
		if !more {
			break
		}
	}
	if got := strings.Join(drained, ","); got != "tx1,tx2,tx3,tx4,tx5" {
		t.Fatalf("drained %s, want all five in order with no duplicate", got)
	}
	if cursor != 5 {
		t.Fatalf("final next = %d, want the head 5", cursor)
	}
}

func TestSinceLimitExactFitIsNotMoreAndEmptyPageKeepsTheCursor(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()
	store.Append(newRecord("tx1", 0))
	store.Append(newRecord("tx2", 0))

	page, next, more := store.SinceLimit(0, 2)
	if len(page) != 2 || next != 2 || more {
		t.Fatalf("exact fit: %d records, next %d, more %v; want 2, 2, false", len(page), next, more)
	}
	page, next, more = store.SinceLimit(7, 2)
	if len(page) != 0 || next != 7 || more {
		t.Fatalf("since past the head: %d records, next %d, more %v; want 0, 7, false", len(page), next, more)
	}
}
