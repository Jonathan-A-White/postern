package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/auth"
	"github.com/Jonathan-A-White/postern/server/internal/blobs"
	"github.com/Jonathan-A-White/postern/server/internal/index"
	"github.com/Jonathan-A-White/postern/server/internal/notify"
	"github.com/Jonathan-A-White/postern/server/internal/push"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
	"github.com/btcsuite/btcd/btcec/v2"
)

// newServerWithOptions builds a licensed test server (every proof held)
// with the given handler options, answering WhatsOnChain calls with 404.
func newServerWithOptions(t *testing.T, opts ...Option) (*httptest.Server, *index.Store) {
	t.Helper()
	wocServer := httptest.NewServer(http.NotFoundHandler())
	t.Cleanup(wocServer.Close)
	client := woc.NewClient(wocServer.URL, woc.WithMinSpacing(0), woc.WithSleep(func(time.Duration) {}))

	store, err := index.Open(t.TempDir())
	if err != nil {
		t.Fatalf("index.Open: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	pushStore, err := push.OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("push.OpenStore: %v", err)
	}
	blobStore, err := blobs.OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("blobs.OpenStore: %v", err)
	}

	handler := NewHandler(store, client, "test-vapid-public-key", pushStore, blobStore, auth.NewNonceStore(time.Minute), &stubChecker{held: true}, opts...)
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return server, store
}

func newKey(t *testing.T) (*btcec.PrivateKey, string) {
	t.Helper()
	key, err := btcec.NewPrivateKey()
	if err != nil {
		t.Fatalf("btcec.NewPrivateKey: %v", err)
	}
	return key, hex.EncodeToString(key.PubKey().SerializeCompressed())
}

// pushBytes encodes one script push the way @bsv/sdk's writeBin does: a bare
// length byte under 0x4c, then OP_PUSHDATA1/2.
func pushBytes(data []byte) []byte {
	var out []byte
	switch {
	case len(data) < 0x4c:
		out = append(out, byte(len(data)))
	case len(data) <= 0xff:
		out = append(out, 0x4c, byte(len(data)))
	default:
		out = append(out, 0x4d)
		out = binary.LittleEndian.AppendUint16(out, uint16(len(data)))
	}
	return append(out, data...)
}

// recordScript is OP_FALSE OP_RETURN <'nftgate'> <version> <payload>.
func recordScript(version byte, payload []byte) []byte {
	script := []byte{0x00, 0x6a}
	script = append(script, pushBytes([]byte("nftgate"))...)
	script = append(script, pushBytes([]byte{version})...)
	return append(script, pushBytes(payload)...)
}

// envelope is a protocol §1 payload from the given sender.
func envelope(from string) []byte {
	return []byte(fmt.Sprintf(`{"v":1,"kind":"msg","class":"message","to":"029cbf013d04ca50ba852816c2802b06ca5ed37b44be9597fc0f95360e209afa97","from":%q,"ts":1758700000,"ct":"QkIQMwOdGrrsn1cVoVx2KCRBcJUeD4Xof2jKU5PT+fw/ojppyAKcvwE9BMpQuoUoFsKAKwbKXtN7RL6Vl/wPlTYOIJr6ly29yXkTykfSVSTrUVnERI/lCUsFLuvVhgyN79hFczet0W67HhaxJRMUSM/BXPUDPdFB/gQbllS0XYOgVPldzejkyjylJbipQqP4YgfBX9ZMXE8wgY4FS6wVF6bMvLwC4WA0bupV8apiP8jK9Q=="}`, from))
}

func postDirect(t *testing.T, server *httptest.Server, key *btcec.PrivateKey, body string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, server.URL+"/api/messages", strings.NewReader(body))
	if err != nil {
		t.Fatalf("building request: %v", err)
	}
	signRequest(t, server, key, req)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST /api/messages: %v", err)
	}
	return resp
}

type directResponse struct {
	TxID  string `json:"txid"`
	Seq   uint64 `json:"seq"`
	Error string `json:"error"`
}

func decodeDirect(t *testing.T, resp *http.Response) directResponse {
	t.Helper()
	defer resp.Body.Close()
	var out directResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	return out
}

// recordingNotifier counts the records it was told about.
type recordingNotifier struct {
	mu   sync.Mutex
	recs []index.Record
}

func (n *recordingNotifier) RecordIndexed(rec index.Record) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.recs = append(n.recs, rec)
}

func (n *recordingNotifier) records() []index.Record {
	n.mu.Lock()
	defer n.mu.Unlock()
	return append([]index.Record(nil), n.recs...)
}

func TestDirectMessageIsIndexedWithADirectTxID(t *testing.T) {
	notifier := &recordingNotifier{}
	server, store := newServerWithOptions(t, WithNotifier(notifier))
	key, pubKeyHex := newKey(t)
	script := recordScript(1, envelope(pubKeyHex))

	resp := postDirect(t, server, key, `{"scriptHex":"`+hex.EncodeToString(script)+`"}`)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	out := decodeDirect(t, resp)
	sum := sha256.Sum256(script)
	wantID := "direct:" + hex.EncodeToString(sum[:])
	if out.TxID != wantID || out.Seq != 1 {
		t.Fatalf("response = %+v, want txid %s seq 1", out, wantID)
	}

	records, _ := store.Since(0)
	if len(records) != 1 {
		t.Fatalf("stored %d records, want 1", len(records))
	}
	rec := records[0]
	if rec.TxID != wantID || rec.Vout != 0 || rec.Height != 0 || rec.Signer != pubKeyHex {
		t.Fatalf("record = %+v, want txid %s, vout 0, height 0, signer %s", rec, wantID, pubKeyHex)
	}
	if rec.ScriptHex != hex.EncodeToString(script) || !bytes.Equal(rec.Payload, envelope(pubKeyHex)) {
		t.Fatalf("record script/payload = %s / %s, want the posted script and its payload", rec.ScriptHex, rec.Payload)
	}
	zero := make([]byte, 32)
	chain := sha256.Sum256(append(zero, wantID...))
	if rec.Chain != hex.EncodeToString(chain[:]) {
		t.Fatalf("record.Chain = %q, want sha256(32 zero bytes || id)", rec.Chain)
	}
	if got := notifier.records(); len(got) != 1 || got[0].Seq != 1 || got[0].TxID != wantID {
		t.Fatalf("notified %+v, want the stored record once", got)
	}
}

func TestDirectMessageIsReturnedByGetMessagesLikeAnyOther(t *testing.T) {
	server, _ := newServerWithOptions(t)
	key, pubKeyHex := newKey(t)
	script := recordScript(1, envelope(pubKeyHex))
	decodeDirect(t, postDirect(t, server, key, `{"scriptHex":"`+hex.EncodeToString(script)+`"}`))

	resp := doAuthorized(t, http.MethodGet, server.URL+"/api/messages?since=0", nil, server)
	defer resp.Body.Close()
	var out struct {
		Records []struct {
			TxID      string          `json:"txid"`
			ScriptHex string          `json:"scriptHex"`
			Height    int             `json:"height"`
			Signer    string          `json:"signer"`
			Chain     string          `json:"chain"`
			Payload   json.RawMessage `json:"payload"`
		} `json:"records"`
		Next uint64 `json:"next"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decoding: %v", err)
	}
	if len(out.Records) != 1 || out.Next != 1 {
		t.Fatalf("records = %+v next = %d, want the direct record", out.Records, out.Next)
	}
	got := out.Records[0]
	if !strings.HasPrefix(got.TxID, "direct:") || got.ScriptHex != hex.EncodeToString(script) || got.Height != 0 || got.Signer != pubKeyHex || got.Chain == "" {
		t.Fatalf("record = %+v", got)
	}
	var payload struct {
		From string `json:"from"`
	}
	if json.Unmarshal(got.Payload, &payload) != nil || payload.From != pubKeyHex {
		t.Fatalf("payload = %s, want the parsed envelope", got.Payload)
	}
}

func TestDirectMessageRepeatIsHarmless(t *testing.T) {
	notifier := &recordingNotifier{}
	server, store := newServerWithOptions(t, WithNotifier(notifier))
	key, pubKeyHex := newKey(t)
	scriptHex := hex.EncodeToString(recordScript(1, envelope(pubKeyHex)))

	first := decodeDirect(t, postDirect(t, server, key, `{"scriptHex":"`+scriptHex+`"}`))
	// The same bytes, hex upper-cased: still the same record.
	resp := postDirect(t, server, key, `{"scriptHex":"`+strings.ToUpper(scriptHex)+`"}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("repeat status = %d, want 200", resp.StatusCode)
	}
	again := decodeDirect(t, resp)
	if again.TxID != first.TxID || again.Seq != first.Seq {
		t.Fatalf("repeat = %+v, want %+v", again, first)
	}
	if records, _ := store.Since(0); len(records) != 1 {
		t.Fatalf("stored %d records, want 1", len(records))
	}
	if n := len(notifier.records()); n != 1 {
		t.Fatalf("notified %d times, want once (a repeat is not a new record)", n)
	}
}

func TestDirectMessageFromSomeoneElseIsForbidden(t *testing.T) {
	server, store := newServerWithOptions(t)
	key, _ := newKey(t)
	_, otherPubKeyHex := newKey(t)

	resp := postDirect(t, server, key, `{"scriptHex":"`+hex.EncodeToString(recordScript(1, envelope(otherPubKeyHex)))+`"}`)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", resp.StatusCode)
	}
	if out := decodeDirect(t, resp); out.Error == "" {
		t.Fatal("error message is empty")
	}
	if records, _ := store.Since(0); len(records) != 0 {
		t.Fatalf("stored %d records, want none", len(records))
	}
}

func TestDirectMessageRejectsBadInput(t *testing.T) {
	server, store := newServerWithOptions(t)
	key, pubKeyHex := newKey(t)
	notMsg := []byte(strings.Replace(string(envelope(pubKeyHex)), `"kind":"msg"`, `"kind":"mint"`, 1))

	for _, tc := range []struct{ name, body string }{
		{"not JSON", `scriptHex`},
		{"no scriptHex", `{}`},
		{"not hex", `{"scriptHex":"zz"}`},
		{"not a record", `{"scriptHex":"76a914` + strings.Repeat("ab", 20) + `88ac"}`},
		{"version 2 record", `{"scriptHex":"` + hex.EncodeToString(recordScript(2, envelope(pubKeyHex))) + `"}`},
		{"payload not JSON", `{"scriptHex":"` + hex.EncodeToString(recordScript(1, []byte("hello"))) + `"}`},
		{"payload not an envelope", `{"scriptHex":"` + hex.EncodeToString(recordScript(1, notMsg)) + `"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp := postDirect(t, server, key, tc.body)
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", resp.StatusCode)
			}
			if out := decodeDirect(t, resp); out.Error == "" {
				t.Fatal("error message is empty")
			}
		})
	}
	if records, _ := store.Since(0); len(records) != 0 {
		t.Fatalf("stored %d records, want none", len(records))
	}
}

func TestDirectMessageRejectsABodyOver256KiB(t *testing.T) {
	server, _ := newServerWithOptions(t)
	key, _ := newKey(t)

	body := `{"scriptHex":"` + strings.Repeat("ab", 128*1024) + `"}`
	resp := postDirect(t, server, key, body)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", resp.StatusCode)
	}
}

func TestDirectMessageRequiresAuthorization(t *testing.T) {
	server, _ := newServerWithOptions(t)
	resp, err := http.Post(server.URL+"/api/messages", "application/json", strings.NewReader(`{"scriptHex":"00"}`))
	if err != nil {
		t.Fatalf("POST /api/messages: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}

func TestMeAnswersTheCallerTheMayorAndTheFeatures(t *testing.T) {
	const mayor = "029cbf013d04ca50ba852816c2802b06ca5ed37b44be9597fc0f95360e209afa97"
	server, _ := newServerWithOptions(t, WithIdentity(mayor, "testnet"))
	key, pubKeyHex := newKey(t)

	req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/me", nil)
	signRequest(t, server, key, req)
	// The key's hex case in the header must not matter.
	req.Header.Set("Authorization", strings.Replace(req.Header.Get("Authorization"), pubKeyHex, strings.ToUpper(pubKeyHex), 1))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /api/me: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d (%s), want 200", resp.StatusCode, body)
	}
	body, _ := io.ReadAll(resp.Body)
	want := `{"pubkey":"` + pubKeyHex + `","mayor":"` + mayor + `","network":"testnet","features":["direct","events","view","beads","me"]}` + "\n"
	if string(body) != want {
		t.Fatalf("body = %s, want %s", body, want)
	}
}

func TestMeAnswersAnEmptyMayorWhenUnset(t *testing.T) {
	server, _ := newServerWithOptions(t)
	resp := doAuthorized(t, http.MethodGet, server.URL+"/api/me", nil, server)
	defer resp.Body.Close()
	var out struct {
		Mayor   *string `json:"mayor"`
		Network string  `json:"network"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decoding: %v", err)
	}
	if out.Mayor == nil || *out.Mayor != "" || out.Network != "testnet" {
		t.Fatalf("mayor = %v, network = %q, want an empty mayor and testnet", out.Mayor, out.Network)
	}
}

var _ notify.Notifier = (*recordingNotifier)(nil)
