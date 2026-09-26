package poller

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/index"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
)

// fakeNotifier records every record it was told about, so a test can assert
// the poller calls it once per stored record and never for a skipped tx.
type fakeNotifier struct {
	mu       sync.Mutex
	notified []string // txid:payload
}

func (f *fakeNotifier) NotifyRecord(txid string, payload json.RawMessage) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.notified = append(f.notified, txid+":"+string(payload))
	return nil
}

func (f *fakeNotifier) calls() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.notified...)
}

func pushData(data []byte) []byte {
	out := make([]byte, 0, len(data)+1)
	out = append(out, byte(len(data)))
	out = append(out, data...)
	return out
}

func buildRecordScript(version byte, payload []byte) []byte {
	var script []byte
	script = append(script, 0x00, 0x6a)
	script = append(script, pushData([]byte("nftgate"))...)
	script = append(script, pushData([]byte{version})...)
	script = append(script, pushData(payload)...)
	return script
}

func writeVarInt(buf *bytes.Buffer, n uint64) {
	buf.WriteByte(byte(n)) // every test tx here has small counts
}

func buildRawTx(outputScripts [][]byte) string {
	return buildRawTxWithScriptSig(nil, outputScripts)
}

func buildRawTxWithScriptSig(scriptSig []byte, outputScripts [][]byte) string {
	var buf bytes.Buffer
	binary.Write(&buf, binary.LittleEndian, uint32(1))

	writeVarInt(&buf, 1)
	buf.Write(bytes.Repeat([]byte{0x11}, 32))
	binary.Write(&buf, binary.LittleEndian, uint32(0))
	writeVarInt(&buf, uint64(len(scriptSig)))
	buf.Write(scriptSig)
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

// buildP2PKHScriptSig builds a standard <sig> <pubkey> unlocking script.
func buildP2PKHScriptSig(pubKey []byte) []byte {
	sig := bytes.Repeat([]byte{0x30}, 71)
	var script []byte
	script = append(script, pushData(sig)...)
	script = append(script, pushData(pubKey)...)
	return script
}

// fakeWOC serves a fixed history and a fixed set of transaction hexes,
// counting how many times each tx's hex was fetched.
type fakeWOC struct {
	history    string
	txHex      map[string]string
	hexFetches map[string]int
}

func (f *fakeWOC) handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/address/mAnchor/history":
			w.Write([]byte(f.history))
		case strings.HasPrefix(r.URL.Path, "/tx/") && strings.HasSuffix(r.URL.Path, "/hex"):
			txid := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/tx/"), "/hex")
			f.hexFetches[txid]++
			hexStr, ok := f.txHex[txid]
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.Write([]byte(hexStr))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}
}

func TestPollOnceIndexesRecordsAndSkipsSeenTx(t *testing.T) {
	msg1 := buildRecordScript(1, []byte(`{"kind":"msg","ciphertext":"aaa"}`))
	msg2 := buildRecordScript(1, []byte(`{"kind":"msg","ciphertext":"bbb"}`))
	notRecord := []byte{0x76, 0xa9, 0x00, 0x88, 0xac}

	fake := &fakeWOC{
		history: `[{"tx_hash":"tx1","height":100},{"tx_hash":"tx2","height":101}]`,
		txHex: map[string]string{
			"tx1": buildRawTx([][]byte{msg1, notRecord}),
			"tx2": buildRawTx([][]byte{msg2}),
		},
		hexFetches: map[string]int{},
	}
	server := httptest.NewServer(fake.handler())
	defer server.Close()

	client := woc.NewClient(server.URL, woc.WithMinSpacing(0), woc.WithSleep(func(time.Duration) {}))
	store, err := index.Open(t.TempDir())
	if err != nil {
		t.Fatalf("index.Open: %v", err)
	}
	defer store.Close()

	p := New(client, store, "mAnchor")

	if err := p.PollOnce(); err != nil {
		t.Fatalf("PollOnce: %v", err)
	}

	records, next := store.Since(0)
	if len(records) != 2 {
		t.Fatalf("len(records) = %d, want 2", len(records))
	}
	if next != 2 {
		t.Fatalf("next = %d, want 2", next)
	}
	if records[0].TxID != "tx1" || records[0].Vout != 0 {
		t.Fatalf("records[0] = %+v, want tx1 vout 0", records[0])
	}
	if records[1].TxID != "tx2" || records[1].Vout != 0 {
		t.Fatalf("records[1] = %+v, want tx2 vout 0", records[1])
	}

	// A second poll pass must not re-fetch either tx's hex.
	if err := p.PollOnce(); err != nil {
		t.Fatalf("second PollOnce: %v", err)
	}
	if fake.hexFetches["tx1"] != 1 {
		t.Fatalf("tx1 hex fetched %d times, want 1", fake.hexFetches["tx1"])
	}
	if fake.hexFetches["tx2"] != 1 {
		t.Fatalf("tx2 hex fetched %d times, want 1", fake.hexFetches["tx2"])
	}

	records, next = store.Since(0)
	if len(records) != 2 || next != 2 {
		t.Fatalf("second poll changed the index: records=%d next=%d", len(records), next)
	}
}

func TestPollOnceNotifiesOncePerStoredRecord(t *testing.T) {
	msg1 := buildRecordScript(1, []byte(`{"kind":"msg","to":"aaa"}`))
	msg2 := buildRecordScript(1, []byte(`{"kind":"msg","to":"bbb"}`))
	notRecord := []byte{0x76, 0xa9, 0x00, 0x88, 0xac}

	fake := &fakeWOC{
		history: `[{"tx_hash":"tx1","height":100},{"tx_hash":"tx2","height":101}]`,
		txHex: map[string]string{
			"tx1": buildRawTx([][]byte{msg1, notRecord}),
			"tx2": buildRawTx([][]byte{msg2}),
		},
		hexFetches: map[string]int{},
	}
	server := httptest.NewServer(fake.handler())
	defer server.Close()

	client := woc.NewClient(server.URL, woc.WithMinSpacing(0), woc.WithSleep(func(time.Duration) {}))
	store, err := index.Open(t.TempDir())
	if err != nil {
		t.Fatalf("index.Open: %v", err)
	}
	defer store.Close()

	notifier := &fakeNotifier{}
	p := New(client, store, "mAnchor", WithNotifier(notifier))

	if err := p.PollOnce(); err != nil {
		t.Fatalf("PollOnce: %v", err)
	}

	calls := notifier.calls()
	if len(calls) != 2 {
		t.Fatalf("calls = %v, want 2 (one per stored record)", calls)
	}
	if calls[0] != `tx1:{"kind":"msg","to":"aaa"}` {
		t.Fatalf("calls[0] = %q, want the tx1 record", calls[0])
	}
	if calls[1] != `tx2:{"kind":"msg","to":"bbb"}` {
		t.Fatalf("calls[1] = %q, want the tx2 record", calls[1])
	}

	// A second poll must not re-notify: both txs are already seen.
	if err := p.PollOnce(); err != nil {
		t.Fatalf("second PollOnce: %v", err)
	}
	if len(notifier.calls()) != 2 {
		t.Fatalf("calls after second poll = %v, want still 2", notifier.calls())
	}
}

func TestPollOnceSkipsTxWithNoRecords(t *testing.T) {
	notRecord := []byte{0x76, 0xa9, 0x00, 0x88, 0xac}
	fake := &fakeWOC{
		history: `[{"tx_hash":"tx1"}]`,
		txHex: map[string]string{
			"tx1": buildRawTx([][]byte{notRecord}),
		},
		hexFetches: map[string]int{},
	}
	server := httptest.NewServer(fake.handler())
	defer server.Close()

	client := woc.NewClient(server.URL, woc.WithMinSpacing(0), woc.WithSleep(func(time.Duration) {}))
	store, err := index.Open(t.TempDir())
	if err != nil {
		t.Fatalf("index.Open: %v", err)
	}
	defer store.Close()

	p := New(client, store, "mAnchor")
	if err := p.PollOnce(); err != nil {
		t.Fatalf("PollOnce: %v", err)
	}

	records, _ := store.Since(0)
	if len(records) != 0 {
		t.Fatalf("len(records) = %d, want 0", len(records))
	}
	if !store.SeenTx("tx1") {
		t.Fatal("tx1 should be marked seen even though it carried no records")
	}

	if err := p.PollOnce(); err != nil {
		t.Fatalf("second PollOnce: %v", err)
	}
	if fake.hexFetches["tx1"] != 1 {
		t.Fatalf("tx1 hex fetched %d times, want 1 (should not be re-fetched)", fake.hexFetches["tx1"])
	}
}

func TestPollOnceRecordsSignerFromScriptSig(t *testing.T) {
	pubKey := append([]byte{0x02}, bytes.Repeat([]byte{0xcd}, 32)...)
	msg := buildRecordScript(1, []byte(`{"kind":"msg"}`))
	fake := &fakeWOC{
		history: `[{"tx_hash":"tx1","height":100}]`,
		txHex: map[string]string{
			"tx1": buildRawTxWithScriptSig(buildP2PKHScriptSig(pubKey), [][]byte{msg}),
		},
		hexFetches: map[string]int{},
	}
	server := httptest.NewServer(fake.handler())
	defer server.Close()

	client := woc.NewClient(server.URL, woc.WithMinSpacing(0), woc.WithSleep(func(time.Duration) {}))
	store, err := index.Open(t.TempDir())
	if err != nil {
		t.Fatalf("index.Open: %v", err)
	}
	defer store.Close()

	p := New(client, store, "mAnchor")
	if err := p.PollOnce(); err != nil {
		t.Fatalf("PollOnce: %v", err)
	}

	records, _ := store.Since(0)
	if len(records) != 1 {
		t.Fatalf("len(records) = %d, want 1", len(records))
	}
	if records[0].Signer != hex.EncodeToString(pubKey) {
		t.Fatalf("Signer = %q, want %q", records[0].Signer, hex.EncodeToString(pubKey))
	}
}

func TestPollOnceEmptyScriptSigLeavesSignerBlank(t *testing.T) {
	msg := buildRecordScript(1, []byte(`{"kind":"msg"}`))
	fake := &fakeWOC{
		history: `[{"tx_hash":"tx1","height":100}]`,
		txHex: map[string]string{
			"tx1": buildRawTx([][]byte{msg}),
		},
		hexFetches: map[string]int{},
	}
	server := httptest.NewServer(fake.handler())
	defer server.Close()

	client := woc.NewClient(server.URL, woc.WithMinSpacing(0), woc.WithSleep(func(time.Duration) {}))
	store, err := index.Open(t.TempDir())
	if err != nil {
		t.Fatalf("index.Open: %v", err)
	}
	defer store.Close()

	p := New(client, store, "mAnchor")
	if err := p.PollOnce(); err != nil {
		t.Fatalf("PollOnce: %v", err)
	}

	records, _ := store.Since(0)
	if len(records) != 1 {
		t.Fatalf("len(records) = %d, want 1", len(records))
	}
	if records[0].Signer != "" {
		t.Fatalf("Signer = %q, want empty", records[0].Signer)
	}
}

func TestPollOnceUnconfirmedHeightIsZero(t *testing.T) {
	msg := buildRecordScript(1, []byte(`{"kind":"msg"}`))
	fake := &fakeWOC{
		history: `[{"tx_hash":"tx1"}]`,
		txHex: map[string]string{
			"tx1": buildRawTx([][]byte{msg}),
		},
		hexFetches: map[string]int{},
	}
	server := httptest.NewServer(fake.handler())
	defer server.Close()

	client := woc.NewClient(server.URL, woc.WithMinSpacing(0), woc.WithSleep(func(time.Duration) {}))
	store, err := index.Open(t.TempDir())
	if err != nil {
		t.Fatalf("index.Open: %v", err)
	}
	defer store.Close()

	p := New(client, store, "mAnchor")
	if err := p.PollOnce(); err != nil {
		t.Fatalf("PollOnce: %v", err)
	}

	records, _ := store.Since(0)
	if len(records) != 1 || records[0].Height != 0 {
		t.Fatalf("records = %+v, want one record with height 0", records)
	}
}
