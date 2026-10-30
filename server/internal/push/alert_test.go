package push

import (
	"net/http/httptest"
	"testing"

	webpush "github.com/SherClockHolmes/webpush-go"
)

func alertSender(t *testing.T, ideasOn map[string]bool) (*Sender, *fakePushEndpoint) {
	t.Helper()
	fake := newFakePushEndpoint()
	server := httptest.NewServer(fake.handler())
	t.Cleanup(server.Close)
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for endpoint, key := range map[string]string{"/a1": "key-a", "/a2": "key-a", "/b1": "key-b", "/c1": "key-c"} {
		if err := store.Add(Subscription{PublicKeyHex: key, Endpoint: server.URL + endpoint, Keys: webpush.Keys{P256dh: testP256dh, Auth: testAuth}}); err != nil {
			t.Fatal(err)
		}
	}
	sender := NewSender(testKeys(t), "https://postern.allmymind.org", store)
	if ideasOn != nil {
		sender.WithIdeasOnly(fakeIdeasOnly{on: ideasOn})
	}
	return sender, fake
}

func TestNotifyKeysPushesEverySubscriptionOfEveryKeyNamed(t *testing.T) {
	sender, fake := alertSender(t, nil)
	sent, err := sender.NotifyKeys([]string{"key-a", "key-b"}, Payload{Class: "alert", Ts: 1})
	if err != nil || sent != 3 || fake.requestCount() != 3 {
		t.Fatalf("NotifyKeys = %d, %v with %d requests, want 3 (key-a's two and key-b's one, not key-c's)", sent, err, fake.requestCount())
	}
}

func TestNotifyKeysWithholdsFromAKeyInIdeasOnly(t *testing.T) {
	sender, fake := alertSender(t, map[string]bool{"key-a": true})
	sent, err := sender.NotifyKeys([]string{"key-a", "key-b"}, Payload{Class: "alert", Ts: 1})
	if err != nil || sent != 1 || fake.requestCount() != 1 {
		t.Fatalf("NotifyKeys = %d, %v with %d requests, want only key-b's", sent, err, fake.requestCount())
	}
}
