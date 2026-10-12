package push

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/Jonathan-A-White/postern/server/internal/ideasonly"
	webpush "github.com/SherClockHolmes/webpush-go"
)

// fakeIdeasOnly answers each key's setting and a state computed from on.
type fakeIdeasOnly struct {
	on      map[string]bool
	reaches ideasonly.Reaches
}

func (f fakeIdeasOnly) Get(key string) (ideasonly.Setting, ideasonly.Status) {
	return ideasonly.Setting{Reaches: f.reaches}, ideasonly.Status{On: f.on[key]}
}

func boolPtr(b bool) *bool { return &b }

// ideasSender is a Sender with one device for "recipient-key", whose Ideas only mode is as given.
func ideasSender(t *testing.T, on bool, reaches ideasonly.Reaches) (*Sender, *fakePushEndpoint, *bytes.Buffer) {
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
	var logged bytes.Buffer
	log.SetOutput(&logged)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	sender := NewSender(testKeys(t), "https://postern.allmymind.org", store).
		WithIdeasOnly(fakeIdeasOnly{on: map[string]bool{"recipient-key": on}, reaches: reaches})
	return sender, fake, &logged
}

func classRecord(t *testing.T, class, summary string) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"v": 1, "kind": "msg", "class": class, "to": "recipient-key", "from": "sender-key",
		"ts": 1758700000, "ct": "ct-" + class, "summary": summary,
	})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestWhileIdeasOnlyIsOnNoRecordClassIsPushedButARingAndAnEmergency(t *testing.T) {
	for _, class := range []string{"message", "decision-needed", "landing", "alarm", "talk", "grist"} {
		t.Run(class, func(t *testing.T) {
			sender, fake, logged := ideasSender(t, true, ideasonly.Reaches{})
			if err := sender.NotifyRecord("direct:ab", classRecord(t, class, "secret words")); err != nil {
				t.Fatalf("NotifyRecord: %v", err)
			}
			if fake.requestCount() != 0 {
				t.Fatalf("%s: %d pushes while Ideas only is on, want 0", class, fake.requestCount())
			}
			if want := "push for record direct:ab: dropped, " + class + " while Ideas only is on"; !strings.Contains(logged.String(), want) {
				t.Errorf("log = %q, want it to contain %q", logged.String(), want)
			}
			if strings.Contains(logged.String(), "secret words") {
				t.Errorf("log = %q, must never carry the words", logged.String())
			}
		})
	}
}

func TestWhileIdeasOnlyIsOnARingAndAnEmergencyAreStillPushed(t *testing.T) {
	sender, fake, _ := ideasSender(t, true, ideasonly.Reaches{})
	if err := sender.NotifyRecord("direct:01", callRecord(t, "ring", "Back now.")); err != nil {
		t.Fatalf("NotifyRecord(ring): %v", err)
	}
	if fake.requestCount() != 1 {
		t.Fatalf("a ring sent %d pushes, want 1", fake.requestCount())
	}
	sender, fake, _ = ideasSender(t, true, ideasonly.Reaches{})
	if err := sender.NotifyRecord("direct:02", eventsRecord(t, "emergency", "")); err != nil {
		t.Fatalf("NotifyRecord(emergency): %v", err)
	}
	if fake.requestCount() != 1 {
		t.Fatalf("an emergency sent %d pushes, want 1", fake.requestCount())
	}
}

func TestReachesRingOffDropsTheRingAndReachesEmergencyOffDropsTheEmergency(t *testing.T) {
	sender, fake, logged := ideasSender(t, true, ideasonly.Reaches{Ring: boolPtr(false)})
	if err := sender.NotifyRecord("direct:01", callRecord(t, "ring", "Back now.")); err != nil {
		t.Fatal(err)
	}
	if fake.requestCount() != 0 {
		t.Fatalf("a ring with reaches.ring off sent %d pushes, want 0", fake.requestCount())
	}
	if !strings.Contains(logged.String(), "dropped, ring while Ideas only is on") {
		t.Errorf("log = %q, want the dropped ring named", logged.String())
	}
	sender, fake, _ = ideasSender(t, true, ideasonly.Reaches{Ring: boolPtr(false)})
	if err := sender.NotifyRecord("direct:02", eventsRecord(t, "emergency", "")); err != nil {
		t.Fatal(err)
	}
	if fake.requestCount() != 1 {
		t.Fatalf("an emergency with reaches.emergency on sent %d pushes, want 1", fake.requestCount())
	}

	sender, fake, _ = ideasSender(t, true, ideasonly.Reaches{Emergency: boolPtr(false)})
	if err := sender.NotifyRecord("direct:03", eventsRecord(t, "emergency", "")); err != nil {
		t.Fatal(err)
	}
	if fake.requestCount() != 0 {
		t.Fatalf("an emergency with reaches.emergency off sent %d pushes, want 0", fake.requestCount())
	}
	if err := sender.NotifyRecord("direct:04", callRecord(t, "ring", "Back now.")); err != nil {
		t.Fatal(err)
	}
	if fake.requestCount() != 1 {
		t.Fatalf("a ring with reaches.ring on sent %d pushes, want 1", fake.requestCount())
	}
}

func TestANormalLaneEventsRecordIsNeverPushedWhateverReachesSays(t *testing.T) {
	for name, on := range map[string]bool{"mode on": true, "mode off": false} {
		sender, fake, _ := ideasSender(t, on, ideasonly.Reaches{Ring: boolPtr(true), Emergency: boolPtr(true)})
		if err := sender.NotifyRecord("direct:ab", eventsRecord(t, "normal", "")); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if fake.requestCount() != 0 {
			t.Fatalf("%s: a normal-lane events record sent %d pushes, want 0", name, fake.requestCount())
		}
	}
}

func TestWhileIdeasOnlyIsOffEveryRecordIsPushedAsBefore(t *testing.T) {
	sender, fake, _ := ideasSender(t, false, ideasonly.Reaches{Ring: boolPtr(false), Emergency: boolPtr(false)})
	n := 0
	for _, class := range []string{"message", "decision-needed", "landing", "alarm", "talk"} {
		n++
		if err := sender.NotifyRecord("direct:"+class, classRecord(t, class, "words")); err != nil {
			t.Fatal(err)
		}
		if fake.requestCount() != n {
			t.Fatalf("%s: %d pushes, want %d (mode off pushes as before, reaches or not)", class, fake.requestCount(), n)
		}
	}
}

func TestAnotherKeysIdeasOnlyDoesNotSilenceThisOne(t *testing.T) {
	sender, fake, _ := ideasSender(t, false, ideasonly.Reaches{})
	sender.WithIdeasOnly(fakeIdeasOnly{on: map[string]bool{"someone-else": true}})
	if err := sender.NotifyRecord("direct:ab", classRecord(t, "message", "hi")); err != nil {
		t.Fatal(err)
	}
	if fake.requestCount() != 1 {
		t.Fatalf("pushes = %d, want 1", fake.requestCount())
	}
}
