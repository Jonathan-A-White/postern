package push

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	webpush "github.com/SherClockHolmes/webpush-go"
)

// eventsRecord is an events record (docs/protocol.md §22) with its clear lane, when set.
func eventsRecord(t *testing.T, lane, summary string) json.RawMessage {
	t.Helper()
	fields := map[string]any{
		"v": 1, "kind": "msg", "class": "events", "to": "recipient-key", "from": "sender-key",
		"ts": 1758700000, "ct": "AAAA",
	}
	if lane != "" {
		fields["lane"] = lane
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

func TestAnEmergencyEventsRecordIsPushedWithTheEmergencyTitleAndNoWords(t *testing.T) {
	p, ok := recordPush("direct:ab", eventsRecord(t, "emergency", "never shown"))
	if !ok {
		t.Fatal("an emergency events record is not push-worthy")
	}
	want := `{"class":"events","txid":"direct:ab","ts":1758700000,"title":"Emergency"}`
	if got := wireJSON(t, p); got != want {
		t.Fatalf("emergency push = %s, want %s", got, want)
	}
}

func TestAnEventsRecordOfAnyOtherLaneIsNotPushed(t *testing.T) {
	for _, lane := range []string{"normal", "fallback", "", "Emergency", "urgent"} {
		if _, ok := recordPush("direct:ab", eventsRecord(t, lane, "")); ok {
			t.Errorf("an events record in lane %q is push-worthy, want no push", lane)
		}
	}
}

// headerRecorder is a push endpoint that remembers the TTL and Urgency of every push it gets.
type headerRecorder struct {
	mu      sync.Mutex
	ttls    []string
	urgency []string
}

func (h *headerRecorder) handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h.mu.Lock()
		h.ttls = append(h.ttls, r.Header.Get("TTL"))
		h.urgency = append(h.urgency, r.Header.Get("Urgency"))
		h.mu.Unlock()
		w.WriteHeader(http.StatusCreated)
	}
}

// notifyOne sends a record of the given payload to one subscribed device and returns what its push
// service saw, and what was logged.
func notifyOne(t *testing.T, payload json.RawMessage, devices int) (*headerRecorder, string) {
	t.Helper()
	rec := &headerRecorder{}
	server := httptest.NewServer(rec.handler())
	t.Cleanup(server.Close)

	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	for i := 0; i < devices; i++ {
		if err := store.Add(Subscription{
			PublicKeyHex: "recipient-key",
			Endpoint:     server.URL + "/sub" + string(rune('a'+i)),
			Keys:         webpush.Keys{P256dh: testP256dh, Auth: testAuth},
		}); err != nil {
			t.Fatalf("Add: %v", err)
		}
	}

	var logged bytes.Buffer
	log.SetOutput(&logged)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	sender := NewSender(testKeys(t), "https://postern.allmymind.org", store)
	if err := sender.NotifyRecord("direct:ab", payload); err != nil {
		t.Fatalf("NotifyRecord: %v", err)
	}
	return rec, logged.String()
}

func TestAnEmergencyPushLivesAnHourAndIsHighUrgency(t *testing.T) {
	rec, _ := notifyOne(t, eventsRecord(t, "emergency", ""), 1)
	if len(rec.ttls) != 1 {
		t.Fatalf("pushes = %d, want 1", len(rec.ttls))
	}
	if rec.ttls[0] != "3600" {
		t.Errorf("emergency TTL = %q, want 3600", rec.ttls[0])
	}
	if rec.urgency[0] != "high" {
		t.Errorf("emergency Urgency = %q, want high", rec.urgency[0])
	}
}

func TestOtherClassesKeepTheShortTTL(t *testing.T) {
	alarm, err := json.Marshal(map[string]any{"kind": "msg", "class": "alarm", "to": "recipient-key", "from": "s", "ts": 1})
	if err != nil {
		t.Fatal(err)
	}
	rec, _ := notifyOne(t, alarm, 1)
	if len(rec.ttls) != 1 || rec.ttls[0] != "30" {
		t.Errorf("alarm TTL = %v, want [30]", rec.ttls)
	}
	if rec.urgency[0] != "high" {
		t.Errorf("alarm Urgency = %q, want high", rec.urgency[0])
	}
}

func TestASuccessfulPushLogsTheDeviceCount(t *testing.T) {
	_, logged := notifyOne(t, eventsRecord(t, "emergency", ""), 2)
	want := "push for record direct:ab: sent to 2 device(s)"
	if !strings.Contains(logged, want) {
		t.Errorf("log = %q, want it to contain %q", logged, want)
	}
}

func TestARecordNobodyIsSubscribedForLogsNothing(t *testing.T) {
	_, logged := notifyOne(t, eventsRecord(t, "emergency", ""), 0)
	if logged != "" {
		t.Errorf("log = %q, want nothing", logged)
	}
}
