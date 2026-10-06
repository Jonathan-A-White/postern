package push

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"testing"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
)

// twinSender is a Sender with one subscription for "recipient-key", and the fake push service behind it.
func twinSender(t *testing.T) (*Sender, *fakePushEndpoint) {
	t.Helper()
	fake := newFakePushEndpoint()
	server := httptest.NewServer(fake.handler())
	t.Cleanup(server.Close)
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
	return NewSender(testKeys(t), "https://postern.allmymind.org", store), fake
}

func messagePayload(t *testing.T, to, from string, ts int64, ct string) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"v": 1, "kind": "msg", "class": "message", "to": to, "from": from, "ts": ts, "ct": ct,
	})
	if err != nil {
		t.Fatalf("marshaling payload: %v", err)
	}
	return raw
}

func TestADirectRecordAndItsChainTwinArePushedOnce(t *testing.T) {
	const direct, chain = "direct:0ae6c06f", chainTxID
	for name, order := range map[string][2]string{
		"direct first": {direct, chain},
		"chain first":  {chain, direct},
	} {
		t.Run(name, func(t *testing.T) {
			sender, fake := twinSender(t)
			payload := messagePayload(t, "recipient-key", "sender-key", 1790000000, "c2VhbGVk")
			for _, txid := range order {
				if err := sender.NotifyRecord(txid, payload); err != nil {
					t.Fatalf("NotifyRecord(%s): %v", txid, err)
				}
			}
			if got := fake.requestCount(); got != 1 {
				t.Fatalf("requestCount = %d, want 1 (one notification per message)", got)
			}
		})
	}
}

func TestMessagesThatDifferInAnyTwinFieldAreEachPushed(t *testing.T) {
	base := messagePayload(t, "recipient-key", "sender-key", 1790000000, "c2VhbGVk")
	for name, other := range map[string]json.RawMessage{
		"from": messagePayload(t, "recipient-key", "other-sender", 1790000000, "c2VhbGVk"),
		"ts":   messagePayload(t, "recipient-key", "sender-key", 1790000001, "c2VhbGVk"),
		"ct":   messagePayload(t, "recipient-key", "sender-key", 1790000000, "b3RoZXI="),
	} {
		t.Run(name, func(t *testing.T) {
			sender, fake := twinSender(t)
			if err := sender.NotifyRecord("direct:aa", base); err != nil {
				t.Fatalf("NotifyRecord: %v", err)
			}
			if err := sender.NotifyRecord(chainTxID, other); err != nil {
				t.Fatalf("NotifyRecord: %v", err)
			}
			if got := fake.requestCount(); got != 2 {
				t.Fatalf("requestCount = %d, want 2 (different messages)", got)
			}
		})
	}
}

func TestADirectRecordWhosePushReachedNoDeviceDoesNotSilenceItsTwin(t *testing.T) {
	sender, fake := twinSender(t)
	fake.goneFor["/sub1"] = true // the push service drops the subscription: nothing was delivered
	payload := messagePayload(t, "recipient-key", "sender-key", 1790000000, "c2VhbGVk")
	if err := sender.NotifyRecord("direct:aa", payload); err != nil {
		t.Fatalf("NotifyRecord: %v", err)
	}
	if got, want := sender.twins.len(), 0; got != want {
		t.Fatalf("remembered %d keys after a push that reached nobody, want %d", got, want)
	}
}

func TestRememberedTwinKeysExpireAndAreCapped(t *testing.T) {
	now := time.Unix(1790000000, 0)
	seen := newTwinMemory(time.Hour, 3)
	seen.now = func() time.Time { return now }

	if !seen.claim("a") || seen.claim("a") {
		t.Fatal("a key is claimed once, then refused")
	}
	now = now.Add(time.Hour + time.Second)
	if !seen.claim("a") {
		t.Fatal("a key older than the memory's lifetime is forgotten")
	}
	if seen.len() != 1 {
		t.Fatalf("len after expiry = %d, want 1", seen.len())
	}

	for i := 0; i < 10; i++ {
		seen.claim(fmt.Sprintf("k%d", i))
		now = now.Add(time.Second)
	}
	if seen.len() > 3 {
		t.Fatalf("len = %d, want at most the cap of 3", seen.len())
	}
	if seen.claim("k9") {
		t.Fatal("the newest key must still be remembered after the cap evicts the oldest")
	}
}
