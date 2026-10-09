package licence

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/chain"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
)

// spendingReader is a fakeReader that also answers who spent an outpoint
// (chain.SpendReader) and counts the histories it is asked for, per address.
type spendingReader struct {
	*fakeReader
	spends       map[string]string // "txid:vout" -> the spending txid
	historyCalls map[string]int
}

func newSpendingReader() *spendingReader {
	return &spendingReader{fakeReader: newFakeReader(), spends: map[string]string{}, historyCalls: map[string]int{}}
}

func (r *spendingReader) GetHistory(address string) ([]woc.HistoryEntry, error) {
	r.historyCalls[address]++
	return r.fakeReader.GetHistory(address)
}

func (r *spendingReader) GetSpender(txid string, vout int) (string, bool, error) {
	spender, spent := r.spends[fmt.Sprintf("%s:%d", txid, vout)]
	return spender, spent, nil
}

// spend puts tx on chain (in no history, as a spend paid wholly from the
// licence's Fuel is) and records that it spends its inputs' outpoints.
func (r *spendingReader) spend(tx testTx, inputs ...string) {
	r.fakeReader.txs[tx.txid] = tx.hex
	for _, outpoint := range inputs {
		r.spends[outpoint] = tx.txid
	}
}

func find(t *testing.T, reader Reader, address string, rule Rule, remembered []Mint) Result {
	t.Helper()
	result, err := Find(reader, address, rule, remembered)
	if err != nil {
		t.Fatalf("Find: %v", err)
	}
	return result
}

func TestFindNamesTheMintItFoundSoItCanBeRemembered(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	mint := contractMint(issuer, "postern", addressOf(holder))
	reader := newSpendingReader()
	reader.add(mint, addressOf(issuer))

	result := find(t, reader, addressOf(holder), Rule{IssuerKey: pubHex(issuer)}, nil)

	if !reflect.DeepEqual(result.Collections, []string{"postern"}) {
		t.Fatalf("collections = %v, want [postern]", result.Collections)
	}
	if want := []Mint{{Txid: mint.txid, Collection: "postern"}}; !reflect.DeepEqual(result.Mints, want) {
		t.Fatalf("mints = %v, want %v", result.Mints, want)
	}
	if got := reader.historyCalls[addressOf(holder)]; got != 0 {
		t.Fatalf("the holder's history was read %d times, want 0: the issuer's history and the spend of the licence say all", got)
	}
}

func TestRefreshOfARememberedMintReadsOnlyTheIssuersHistory(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	mint := contractMint(issuer, "postern", addressOf(holder))
	reader := newSpendingReader()
	reader.add(mint, addressOf(issuer))
	// A holder who has sent thousands of messages: a history no walk should read.
	for h := 0; h < 6000; h++ {
		reader.fakeReader.history[addressOf(holder)] = append(reader.fakeReader.history[addressOf(holder)], woc.HistoryEntry{TxHash: fmt.Sprintf("%064x", h+1), Height: 1000 + h})
	}
	rule := Rule{IssuerKey: pubHex(issuer)}
	remembered := []Mint{{Txid: mint.txid, Collection: "postern"}}

	result := find(t, reader, addressOf(holder), rule, remembered)

	if !reflect.DeepEqual(result.Collections, []string{"postern"}) {
		t.Fatalf("collections = %v, want [postern]", result.Collections)
	}
	if got := reader.historyCalls[addressOf(issuer)]; got != 1 {
		t.Fatalf("issuer history calls = %d, want 1", got)
	}
	if got := reader.historyCalls[addressOf(holder)]; got != 0 {
		t.Fatalf("holder history calls = %d, want 0", got)
	}
}

func TestRememberedMintIsNotHeldOnceTheIssuerRevokedIt(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	mint := contractMint(issuer, "postern", addressOf(holder))
	reader := newSpendingReader()
	reader.add(mint, addressOf(issuer))
	reader.add(revokeTx(issuer, mint.txid+":0", 0xe1), addressOf(issuer))

	result := find(t, reader, addressOf(holder), Rule{IssuerKey: pubHex(issuer)}, []Mint{{Txid: mint.txid, Collection: "postern"}})

	if len(result.Collections) != 0 || len(result.Mints) != 0 {
		t.Fatalf("result = %+v, want nothing once the licence is revoked", result)
	}
}

func TestRememberedMintIsNotHeldOnceTheTokenWasTransferred(t *testing.T) {
	issuer, holder, buyer := newTestKey(t), newTestKey(t), newTestKey(t)
	mint := contractMint(issuer, "postern", addressOf(holder))
	transfer := contractSpend(mint, typedRecordScript("TR", `{"to":"`+addressOf(buyer)+`"}`))
	reader := newSpendingReader()
	reader.add(mint, addressOf(issuer))
	reader.spend(transfer, mint.txid+":0", mint.txid+":1")

	rule := Rule{IssuerKey: pubHex(issuer)}
	remembered := []Mint{{Txid: mint.txid, Collection: "postern"}}
	if got := find(t, reader, addressOf(holder), rule, remembered); len(got.Collections) != 0 {
		t.Fatalf("seller collections = %v, want none after the transfer", got.Collections)
	}
	// The buyer holds it: the mint names the seller, but the token moved.
	if got := find(t, reader, addressOf(buyer), rule, remembered); len(got.Collections) != 0 {
		t.Fatalf("a mint naming the seller does not license the buyer by itself, got %v", got.Collections)
	}
}

func TestRememberedMintFollowsAWriteThatLeavesTheTokenWithItsHolder(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	mint := contractMint(issuer, "postern", addressOf(holder))
	write := contractSpend(mint, typedRecordScript("W", `{"note":"hello"}`))
	reader := newSpendingReader()
	reader.add(mint, addressOf(issuer))
	reader.spend(write, mint.txid+":0", mint.txid+":1")

	got := find(t, reader, addressOf(holder), Rule{IssuerKey: pubHex(issuer)}, []Mint{{Txid: mint.txid, Collection: "postern"}})
	if !reflect.DeepEqual(got.Collections, []string{"postern"}) {
		t.Fatalf("collections = %v, want [postern] after a write", got.Collections)
	}
}

func TestFindWithoutSpendLookupWalksAsBefore(t *testing.T) {
	issuer, holder := newTestKey(t), newTestKey(t)
	mint := contractMint(issuer, "postern", addressOf(holder))
	reader := newFakeReader() // no GetSpender
	reader.add(mint, addressOf(issuer))

	result := find(t, reader, addressOf(holder), Rule{IssuerKey: pubHex(issuer)}, nil)
	if !reflect.DeepEqual(result.Collections, []string{"postern"}) {
		t.Fatalf("collections = %v, want [postern]", result.Collections)
	}
}

func TestFindFallsBackToTheWalkWhenTheReaderCannotLookUpSpends(t *testing.T) {
	issuer, holder, buyer := newTestKey(t), newTestKey(t), newTestKey(t)
	mint := contractMint(issuer, "postern", addressOf(holder))
	transfer := contractSpend(mint, typedRecordScript("TR", `{"to":"`+addressOf(buyer)+`"}`))
	reader := &unsupportedSpends{fakeReader: newFakeReader()}
	reader.add(mint, addressOf(issuer))
	reader.add(transfer, addressOf(holder))

	if got := find(t, reader, addressOf(holder), Rule{IssuerKey: pubHex(issuer)}, nil); len(got.Collections) != 0 {
		t.Fatalf("collections = %v, want none: the walk of the holder's history sees the transfer", got.Collections)
	}
}

// unsupportedSpends has the method but says its provider cannot answer it, as
// a TxCache over a reader without spend lookups does.
type unsupportedSpends struct{ *fakeReader }

func (unsupportedSpends) GetSpender(string, int) (string, bool, error) {
	return "", false, chain.ErrNoSpendLookup
}

// A key whose history runs past sixty pages: its mint is still found.
func TestHeldForAMintOnThePageFiftyEightOfSixtyOfWhatsOnChainsHistory(t *testing.T) {
	holder := newTestKey(t)
	address := addressOf(holder)
	mint := contractMint(holder, "postern", address)

	// 6000 confirmed transactions, newest page first; the mint sits on the
	// 58th page of the newest-first order (a page holds 100).
	const pageCount = 60
	pages := make([][]string, pageCount)
	heights := map[string]int{}
	height := 1000 + pageCount*100
	for p := 0; p < pageCount; p++ {
		for i := 0; i < 100; i++ {
			txid := fmt.Sprintf("%064x", p*100+i+1)
			if p == 57 && i == 0 {
				txid = mint.txid
			}
			pages[p] = append(pages[p], txid)
			height--
			heights[txid] = height
		}
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/tx/"+mint.txid+"/hex":
			w.Write([]byte(mint.hex))
		case strings.HasPrefix(r.URL.Path, "/tx/"):
			w.Write([]byte("00")) // a message transaction the rule reads no record from
		case r.URL.Path == "/address/"+address+"/unconfirmed/history":
			w.Write([]byte(`{"address":"` + address + `","result":[],"error":""}`))
		case r.URL.Path == "/address/"+address+"/confirmed/history":
			page := 0
			fmt.Sscanf(r.URL.Query().Get("token"), "page-%d", &page)
			var result []map[string]any
			for _, txid := range pages[page] {
				result = append(result, map[string]any{"tx_hash": txid, "height": heights[txid]})
			}
			reply := map[string]any{"address": address, "result": result, "error": ""}
			if page+1 < pageCount {
				reply["nextPageToken"] = fmt.Sprintf("page-%d", page+1)
			}
			json.NewEncoder(w).Encode(reply)
		default:
			t.Errorf("unexpected path %q", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	client := woc.NewClient(server.URL, woc.WithMinSpacing(0), woc.WithSleep(func(time.Duration) {}))

	if !mustHeld(t, client, address, Rule{}) {
		t.Fatal("held = false, want true for a mint on the 58th of 60 pages of history")
	}
}
