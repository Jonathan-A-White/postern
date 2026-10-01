package push

import (
	"encoding/json"
	"testing"
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
