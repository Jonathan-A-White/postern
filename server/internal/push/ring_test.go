package push

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	webpush "github.com/SherClockHolmes/webpush-go"
)

// callRecord is a call record (docs/protocol.md §21) with its clear role and, when set, summary.
func callRecord(t *testing.T, role, summary string) json.RawMessage {
	t.Helper()
	fields := map[string]any{
		"v": 1, "kind": "msg", "class": "call", "to": "recipient-key", "from": "sender-key",
		"ts": 1758700000, "ct": "AAAA",
	}
	if role != "" {
		fields["role"] = role
	}
	if summary != "" {
		fields["summary"] = summary
	}
	raw, err := json.Marshal(fields)
	if err != nil {
		t.Fatalf("marshaling payload: %v", err)
	}
	return raw
}

func TestARingIsPushedWithTheCallTitleAndTheReasonAsBody(t *testing.T) {
	p, ok := recordPush("direct:ab", callRecord(t, "ring", "Back now: two landings."))
	if !ok {
		t.Fatal("a ring is not push-worthy")
	}
	want := `{"class":"call","txid":"direct:ab","ts":1758700000,"title":"The Mayor is calling","body":"Back now: two landings."}`
	if got := wireJSON(t, p); got != want {
		t.Fatalf("ring push = %s, want %s", got, want)
	}
}

func TestARingWithNoReasonOrOnChainCarriesTheTitleAndNoWords(t *testing.T) {
	for name, p := range map[string]Payload{
		"no summary": mustPush(t, "direct:ab", callRecord(t, "ring", "")),
		"on chain":   mustPush(t, chainTxID, callRecord(t, "ring", "never in the clear on chain")),
	} {
		if p.Title != "The Mayor is calling" || p.Body != "" {
			t.Fatalf("%s: title %q body %q, want the title and no body", name, p.Title, p.Body)
		}
	}
}

func mustPush(t *testing.T, txid string, payload json.RawMessage) Payload {
	t.Helper()
	p, ok := recordPush(txid, payload)
	if !ok {
		t.Fatal("record not push-worthy")
	}
	return p
}

func TestARequestOrLaterOrUnmarkedCallIsNotPushed(t *testing.T) {
	for _, role := range []string{"request", "later", "", "bell"} {
		if p, ok := recordPush("direct:ab", callRecord(t, role, "Call me")); ok {
			t.Fatalf("role %q: pushed %+v, want nothing", role, p)
		}
	}
}

func TestARingReachesTheDeviceAndARequestDoesNot(t *testing.T) {
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

	if err := sender.NotifyRecord("direct:01", callRecord(t, "request", "Call me")); err != nil {
		t.Fatalf("NotifyRecord(request): %v", err)
	}
	if fake.requestCount() != 0 {
		t.Fatalf("a request sent %d pushes, want 0", fake.requestCount())
	}
	if err := sender.NotifyRecord("direct:02", callRecord(t, "ring", "Back now.")); err != nil {
		t.Fatalf("NotifyRecord(ring): %v", err)
	}
	if fake.requestCount() != 1 {
		t.Fatalf("a ring sent %d pushes, want 1", fake.requestCount())
	}
}

// A talk answer's push (docs/protocol.md §20) names the class, the record and the time and
// nothing else: the words are sealed in ct and a talk record carries no summary.
func TestATalkAnswerPushCarriesNoWords(t *testing.T) {
	payload, err := json.Marshal(map[string]any{
		"v": 1, "kind": "msg", "class": "talk", "to": "recipient-key", "from": "sender-key",
		"ts": 1758700000, "ct": "AAAA", "summary": "the answer's words",
	})
	if err != nil {
		t.Fatal(err)
	}
	p := mustPush(t, "direct:ab", payload)
	want := `{"class":"talk","txid":"direct:ab","ts":1758700000}`
	if got := wireJSON(t, p); got != want {
		t.Fatalf("talk answer push = %s, want %s", got, want)
	}
}
