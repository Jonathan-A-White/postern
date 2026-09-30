package push

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"
)

const chainTxID = "3af1c0de3af1c0de3af1c0de3af1c0de3af1c0de3af1c0de3af1c0de3af1c0de"

func recordWithSummary(t *testing.T, class, summary string) json.RawMessage {
	t.Helper()
	fields := map[string]any{
		"v": 1, "kind": "msg", "class": class, "to": "recipient-key", "from": "sender-key",
		"ts": 1758700000, "ct": "AAAA",
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

func wireJSON(t *testing.T, p Payload) string {
	t.Helper()
	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	return string(raw)
}

func TestSummaryOfDirectRecordBecomesPushBody(t *testing.T) {
	for _, class := range []string{"message", "decision-needed", "landing", "alarm"} {
		p, ok := recordPush("direct:ab", recordWithSummary(t, class, "Answer: Pick the colour"))
		if !ok {
			t.Fatalf("%s: record not addressed", class)
		}
		want := `{"class":"` + class + `","txid":"direct:ab","ts":1758700000,"body":"Answer: Pick the colour"}`
		if got := wireJSON(t, p); got != want {
			t.Fatalf("%s: push = %s, want %s", class, got, want)
		}
		if p.Title != "" {
			t.Fatalf("%s: title = %q, the class keeps its own title", class, p.Title)
		}
	}
}

func TestSummaryAbsentPushesClassTxidTsExactly(t *testing.T) {
	p, ok := recordPush("direct:ab", recordWithSummary(t, "message", ""))
	if !ok {
		t.Fatal("record not addressed")
	}
	if got, want := wireJSON(t, p), `{"class":"message","txid":"direct:ab","ts":1758700000}`; got != want {
		t.Fatalf("push = %s, want exactly %s", got, want)
	}

	blank, _ := recordPush("direct:ab", recordWithSummary(t, "message", "   \t "))
	if got, want := wireJSON(t, blank), `{"class":"message","txid":"direct:ab","ts":1758700000}`; got != want {
		t.Fatalf("blank summary: push = %s, want exactly %s", got, want)
	}
}

func TestSummaryOfChainRecordIsNotPushed(t *testing.T) {
	p, ok := recordPush(chainTxID, recordWithSummary(t, "message", "Answer: should stay on chain"))
	if !ok {
		t.Fatal("record not addressed")
	}
	if got, want := wireJSON(t, p), `{"class":"message","txid":"`+chainTxID+`","ts":1758700000}`; got != want {
		t.Fatalf("push = %s, want exactly %s", got, want)
	}
}

func TestSummaryOverEightyRunesIsCutToEightyRunesNotBytes(t *testing.T) {
	long := strings.Repeat("é", 100) + "tail" // 2 bytes a rune: 80 runes is 160 bytes
	p, _ := recordPush("direct:ab", recordWithSummary(t, "message", long))
	if n := utf8.RuneCountInString(p.Body); n != 80 {
		t.Fatalf("body = %d runes, want 80", n)
	}
	if p.Body != strings.Repeat("é", 80) {
		t.Fatalf("body = %q, want the first 80 runes", p.Body)
	}

	exact := strings.Repeat("語", 80)
	p, _ = recordPush("direct:ab", recordWithSummary(t, "message", exact))
	if p.Body != exact {
		t.Fatalf("80-rune summary changed: %q", p.Body)
	}

	spaced := "  " + strings.Repeat("a", 78) + " b"
	p, _ = recordPush("direct:ab", recordWithSummary(t, "message", spaced))
	if want := strings.Repeat("a", 78) + " b"; p.Body != want {
		t.Fatalf("body = %q, want trimmed %q", p.Body, want)
	}
}

func TestSummaryOfGristRecordIsNotPushed(t *testing.T) {
	p, ok := recordPush("direct:ab", recordWithSummary(t, "grist", "Answer: an app's private work"))
	if !ok {
		t.Fatal("record not addressed")
	}
	if p.Body != "" || p.Title != "" {
		t.Fatalf("grist push carries title %q body %q, want neither", p.Title, p.Body)
	}
	if got, want := wireJSON(t, p), `{"class":"grist","txid":"direct:ab","ts":1758700000}`; got != want {
		t.Fatalf("push = %s, want exactly %s", got, want)
	}

	// Any class outside the four cockpit classes keeps its summary to itself.
	p, _ = recordPush("direct:ab", recordWithSummary(t, "move-home", "Answer: nope"))
	if p.Body != "" {
		t.Fatalf("move-home body = %q, want none", p.Body)
	}
}

func TestSummaryDoesNotChangeWhoIsAddressed(t *testing.T) {
	if _, ok := recordPush("direct:ab", json.RawMessage(`{"kind":"mint"}`)); ok {
		t.Fatal("a record with no to/class was addressed")
	}
	if _, ok := recordPush("direct:ab", nil); ok {
		t.Fatal("an empty payload was addressed")
	}
}
