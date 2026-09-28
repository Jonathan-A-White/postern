package push

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/index"
	webpush "github.com/SherClockHolmes/webpush-go"
)

// A real (but not otherwise meaningful) EC public key / auth secret pair,
// taken from webpush-go's own test suite — SendNotificationWithContext needs
// a valid point on the P-256 curve to derive a shared secret, but never talks
// to the real endpoint named in it; that's the fake server below.
const (
	testP256dh = "BNNL5ZaTfK81qhXOx23-wewhigUeFb632jN6LvRWCFH1ubQr77FE_9qV1FuojuRmHP42zmf34rXgW80OvUVDgTk"
	testAuth   = "zqbxT6JKstKSY9JKibZLSQ"
)

// fakePushEndpoint records every push it receives and can be told to answer
// a given endpoint path with 410 Gone instead of success.
type fakePushEndpoint struct {
	mu       sync.Mutex
	requests int
	goneFor  map[string]bool
}

func newFakePushEndpoint() *fakePushEndpoint {
	return &fakePushEndpoint{goneFor: map[string]bool{}}
}

func (f *fakePushEndpoint) handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.requests++
		gone := f.goneFor[r.URL.Path]
		f.mu.Unlock()

		if gone {
			w.WriteHeader(http.StatusGone)
			return
		}
		w.WriteHeader(http.StatusCreated)
	}
}

func (f *fakePushEndpoint) requestCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.requests
}

func testKeys(t *testing.T) VAPIDKeys {
	t.Helper()
	priv, pub, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatalf("GenerateVAPIDKeys: %v", err)
	}
	return VAPIDKeys{PublicKey: pub, PrivateKey: priv}
}

func TestNotifyRecordSendsOnePushPerAddressedRecord(t *testing.T) {
	fake := newFakePushEndpoint()
	server := httptest.NewServer(fake.handler())
	defer server.Close()

	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	if err := store.Add(Subscription{
		PublicKeyHex: "recipient-key",
		Endpoint:     server.URL + "/sub1",
		Keys:         webpush.Keys{P256dh: testP256dh, Auth: testAuth},
	}); err != nil {
		t.Fatalf("Add: %v", err)
	}

	sender := NewSender(testKeys(t), "https://postern.allmymind.org", store)

	addressed, err := json.Marshal(map[string]any{
		"kind": "msg", "class": "alarm", "to": "recipient-key", "from": "sender-key", "ts": 1758700000,
	})
	if err != nil {
		t.Fatalf("marshaling payload: %v", err)
	}
	if err := sender.NotifyRecord("txid-1", addressed); err != nil {
		t.Fatalf("NotifyRecord: %v", err)
	}

	if fake.requestCount() != 1 {
		t.Fatalf("requestCount = %d, want 1", fake.requestCount())
	}
}

func TestNotifyRecordSkipsUnaddressedAndUnsubscribedRecords(t *testing.T) {
	fake := newFakePushEndpoint()
	server := httptest.NewServer(fake.handler())
	defer server.Close()

	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	if err := store.Add(Subscription{
		PublicKeyHex: "recipient-key",
		Endpoint:     server.URL + "/sub1",
		Keys:         webpush.Keys{P256dh: testP256dh, Auth: testAuth},
	}); err != nil {
		t.Fatalf("Add: %v", err)
	}

	sender := NewSender(testKeys(t), "https://postern.allmymind.org", store)

	noPayload := json.RawMessage(nil)
	if err := sender.NotifyRecord("txid-1", noPayload); err != nil {
		t.Fatalf("NotifyRecord (no payload): %v", err)
	}

	notMsgPayload := json.RawMessage(`{"kind":"mint"}`)
	if err := sender.NotifyRecord("txid-2", notMsgPayload); err != nil {
		t.Fatalf("NotifyRecord (no to/class): %v", err)
	}

	someoneElse, err := json.Marshal(map[string]any{"kind": "msg", "class": "message", "to": "someone-else", "ts": 1})
	if err != nil {
		t.Fatalf("marshaling payload: %v", err)
	}
	if err := sender.NotifyRecord("txid-3", someoneElse); err != nil {
		t.Fatalf("NotifyRecord (unsubscribed to): %v", err)
	}

	if fake.requestCount() != 0 {
		t.Fatalf("requestCount = %d, want 0 (no subscribed recipient was addressed)", fake.requestCount())
	}
}

func TestNotifyRecordDropsGoneSubscription(t *testing.T) {
	fake := newFakePushEndpoint()
	fake.goneFor["/sub1"] = true
	server := httptest.NewServer(fake.handler())
	defer server.Close()

	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	sub := Subscription{
		PublicKeyHex: "recipient-key",
		Endpoint:     server.URL + "/sub1",
		Keys:         webpush.Keys{P256dh: testP256dh, Auth: testAuth},
	}
	if err := store.Add(sub); err != nil {
		t.Fatalf("Add: %v", err)
	}

	sender := NewSender(testKeys(t), "https://postern.allmymind.org", store)

	addressed, err := json.Marshal(map[string]any{"kind": "msg", "class": "message", "to": "recipient-key", "ts": 1})
	if err != nil {
		t.Fatalf("marshaling payload: %v", err)
	}
	if err := sender.NotifyRecord("txid-1", addressed); err != nil {
		t.Fatalf("NotifyRecord: %v", err)
	}

	if len(store.ByPublicKey("recipient-key")) != 0 {
		t.Fatalf("subscription should have been dropped after a 410, got %+v", store.ByPublicKey("recipient-key"))
	}
}

func TestRecordIndexedPushesAStoredRecordWithoutBlocking(t *testing.T) {
	fake := newFakePushEndpoint()
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-release
		fake.handler()(w, r)
	}))
	defer server.Close()

	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	if err := store.Add(Subscription{
		PublicKeyHex: "recipient-key",
		Endpoint:     server.URL + "/sub1",
		Keys:         webpush.Keys{P256dh: testP256dh, Auth: testAuth},
	}); err != nil {
		t.Fatalf("Add: %v", err)
	}
	sender := NewSender(testKeys(t), "https://postern.allmymind.org", store)

	payload := json.RawMessage(`{"kind":"msg","class":"message","to":"recipient-key","ts":1}`)
	returned := make(chan struct{})
	go func() {
		sender.RecordIndexed(index.Record{Seq: 1, TxID: "direct:ab", Payload: payload})
		close(returned)
	}()
	select {
	case <-returned:
	case <-time.After(2 * time.Second):
		t.Fatal("RecordIndexed waited on the push service")
	}

	close(release)
	deadline := time.Now().Add(2 * time.Second)
	for fake.requestCount() != 1 {
		if time.Now().After(deadline) {
			t.Fatalf("requestCount = %d, want 1 push for the record", fake.requestCount())
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestPayloadCarriesTitleAndBodyOnlyWhenSet(t *testing.T) {
	record, err := json.Marshal(Payload{Class: "message", TxID: "direct:ab", Ts: 1758700000})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if string(record) != `{"class":"message","txid":"direct:ab","ts":1758700000}` {
		t.Fatalf("record payload = %s, want exactly {class, txid, ts}", record)
	}

	alarm, err := json.Marshal(Payload{Class: "alarm", Ts: 1758700000, Title: "desktop unreachable", Body: "since 12:03Z"})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if string(alarm) != `{"class":"alarm","ts":1758700000,"title":"desktop unreachable","body":"since 12:03Z"}` {
		t.Fatalf("alarm payload = %s", alarm)
	}
}

func TestBroadcastPushesToEverySubscription(t *testing.T) {
	fake := newFakePushEndpoint()
	fake.goneFor["/gone"] = true
	server := httptest.NewServer(fake.handler())
	defer server.Close()

	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	for _, sub := range []Subscription{
		{PublicKeyHex: "governor-phone", Endpoint: server.URL + "/phone"},
		{PublicKeyHex: "governor-laptop", Endpoint: server.URL + "/laptop"},
		{PublicKeyHex: "governor-old", Endpoint: server.URL + "/gone"},
	} {
		sub.Keys = webpush.Keys{P256dh: testP256dh, Auth: testAuth}
		if err := store.Add(sub); err != nil {
			t.Fatalf("Add: %v", err)
		}
	}
	sender := NewSender(testKeys(t), "https://postern.allmymind.org", store)

	delivered, err := sender.Broadcast(Payload{Class: "alarm", Title: "desktop unreachable", Body: "since 12:03Z", Ts: 1})
	if err != nil {
		t.Fatalf("Broadcast: %v", err)
	}
	if delivered != 2 {
		t.Fatalf("delivered = %d, want 2 (the gone subscription isn't delivered to)", delivered)
	}
	if fake.requestCount() != 3 {
		t.Fatalf("requestCount = %d, want one push per subscription", fake.requestCount())
	}
	if len(store.All()) != 2 {
		t.Fatalf("subscriptions = %+v, want the gone one dropped", store.All())
	}
}
