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

func TestStoreKeepsTheCardListAcrossARestartAndAReSubscribeReplacesIt(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	sub := testSubscription("https://push.example/1")
	sub.Last4s = []string{"1111", "2222"}
	if err := store.Add(sub); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := reopened.ByPublicKey("abc"); len(got) != 1 || len(got[0].Last4s) != 2 || got[0].Last4s[1] != "2222" {
		t.Fatalf("after a restart: %+v", got)
	}
	sub.Last4s = []string{"3333"}
	if err := reopened.Add(sub); err != nil {
		t.Fatal(err)
	}
	if got := reopened.ByPublicKey("abc"); len(got) != 1 || len(got[0].Last4s) != 1 || got[0].Last4s[0] != "3333" {
		t.Fatalf("after a re-subscribe: %+v", got)
	}
	sub.Last4s = nil
	if err := reopened.Add(sub); err != nil {
		t.Fatal(err)
	}
	if got := reopened.ByPublicKey("abc"); len(got) != 1 || got[0].Last4s != nil {
		t.Fatalf("a re-subscribe with no list keeps the old one: %+v", got)
	}
}

func TestStoreSaysWhoClaimsACard(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	a := testSubscription("https://push.example/1")
	a.Last4s = []string{"1111"}
	if err := store.Add(a); err != nil {
		t.Fatal(err)
	}
	if err := store.Add(testSubscription("https://push.example/2")); err != nil {
		t.Fatal(err)
	}
	if !store.Claims("1111") || store.Claims("2222") || store.Claims("") {
		t.Fatalf("Claims: 1111=%v 2222=%v empty=%v, want true false false", store.Claims("1111"), store.Claims("2222"), store.Claims(""))
	}
}
