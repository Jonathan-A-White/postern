package poller

import (
	"testing"

	"github.com/Jonathan-A-White/postern/server/internal/chain"
	"github.com/Jonathan-A-White/postern/server/internal/index"
)

// fakeReader is a chain.Reader with no provider behind it.
type fakeReader struct {
	history []chain.HistoryEntry
	txHex   map[string]string
}

func (f *fakeReader) GetHistory(string) ([]chain.HistoryEntry, error) { return f.history, nil }
func (f *fakeReader) GetTransactionHex(txid string) (string, error)   { return f.txHex[txid], nil }

func TestPollOnceIndexesARecordFromTheInterface(t *testing.T) {
	msg := buildRecordScript(1, []byte(`{"kind":"msg","ciphertext":"aaa"}`))
	reader := &fakeReader{
		history: []chain.HistoryEntry{{TxHash: "tx1", Height: 100}},
		txHex:   map[string]string{"tx1": buildRawTx([][]byte{msg})},
	}
	store, err := index.Open(t.TempDir())
	if err != nil {
		t.Fatalf("index.Open: %v", err)
	}
	defer store.Close()

	if err := New(reader, store, "mAnchor").PollOnce(); err != nil {
		t.Fatalf("PollOnce: %v", err)
	}

	records, _ := store.Since(0)
	if len(records) != 1 || records[0].TxID != "tx1" || records[0].Height != 100 {
		t.Fatalf("records = %+v, want one from tx1 at height 100", records)
	}
}
