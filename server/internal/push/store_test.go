package push

import (
	"testing"

	webpush "github.com/SherClockHolmes/webpush-go"
)

func testSubscription(endpoint string) Subscription {
	return Subscription{
		PublicKeyHex: "abc",
		Endpoint:     endpoint,
		Keys:         webpush.Keys{P256dh: "p256dh", Auth: "auth"},
	}
}

func TestStoreAddAndByPublicKey(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}

	if err := store.Add(testSubscription("https://push.example/1")); err != nil {
		t.Fatalf("Add: %v", err)
	}

	subs := store.ByPublicKey("abc")
	if len(subs) != 1 || subs[0].Endpoint != "https://push.example/1" {
		t.Fatalf("subs = %+v, want one subscription for abc", subs)
	}

	if len(store.ByPublicKey("someone-else")) != 0 {
		t.Fatalf("expected no subscriptions for a different pubkey")
	}
}

func TestStoreAddIsIdempotentByEndpoint(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}

	sub := testSubscription("https://push.example/1")
	if err := store.Add(sub); err != nil {
		t.Fatalf("first Add: %v", err)
	}
	if err := store.Add(sub); err != nil {
		t.Fatalf("second Add: %v", err)
	}

	if len(store.ByPublicKey("abc")) != 1 {
		t.Fatalf("subs = %+v, want de-duplication by endpoint", store.ByPublicKey("abc"))
	}
}

func TestStoreRemove(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}

	sub := testSubscription("https://push.example/1")
	if err := store.Add(sub); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := store.Remove(sub.Endpoint); err != nil {
		t.Fatalf("Remove: %v", err)
	}

	if len(store.ByPublicKey("abc")) != 0 {
		t.Fatalf("subs = %+v, want none after Remove", store.ByPublicKey("abc"))
	}
}

func TestStorePersistsAcrossOpen(t *testing.T) {
	dir := t.TempDir()

	store, err := OpenStore(dir)
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	if err := store.Add(testSubscription("https://push.example/1")); err != nil {
		t.Fatalf("Add: %v", err)
	}

	reopened, err := OpenStore(dir)
	if err != nil {
		t.Fatalf("reopening OpenStore: %v", err)
	}
	if len(reopened.ByPublicKey("abc")) != 1 {
		t.Fatalf("subs = %+v, want the subscription to survive a reopen", reopened.ByPublicKey("abc"))
	}
}
