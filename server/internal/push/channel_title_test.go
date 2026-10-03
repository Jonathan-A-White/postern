package push

import (
	"encoding/json"
	"testing"
)

// namedRecord is a message record with its optional clear channel and bead, and summary.
func namedRecord(t *testing.T, class, channel, bead, summary string) json.RawMessage {
	t.Helper()
	fields := map[string]any{
		"v": 1, "kind": "msg", "class": class, "to": "recipient-key", "from": "sender-key",
		"ts": 1758700000, "ct": "AAAA",
	}
	if channel != "" {
		fields["channel"] = channel
	}
	if bead != "" {
		fields["bead"] = bead
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

func TestADirectMessageNamesItsChannelInTheTitleAndItsSummaryInTheBody(t *testing.T) {
	p, ok := recordPush("direct:ab", namedRecord(t, "message", "general", "", "Closing six now..."))
	if !ok {
		t.Fatal("record not addressed")
	}
	want := `{"class":"message","txid":"direct:ab","ts":1758700000,"title":"Message in general","body":"Closing six now..."}`
	if got := wireJSON(t, p); got != want {
		t.Fatalf("push = %s, want %s", got, want)
	}
}

func TestABeadChannelMessageNamesTheBeadId(t *testing.T) {
	p, _ := recordPush("direct:ab", namedRecord(t, "message", "", "mw-gq6.251", "Check the push"))
	if want := "Message on mw-gq6.251"; p.Title != want {
		t.Fatalf("title = %q, want %q", p.Title, want)
	}
	if p.Body != "Check the push" {
		t.Fatalf("body = %q", p.Body)
	}

	// A bead outranks a channel name when a record gives both.
	p, _ = recordPush("direct:ab", namedRecord(t, "message", "general", "mw-gq6.251", ""))
	if want := "Message on mw-gq6.251"; p.Title != want {
		t.Fatalf("title = %q, want %q", p.Title, want)
	}
}

func TestAChainMessageKeepsAPlainTitleNamingTheChannelAndNoBody(t *testing.T) {
	p, ok := recordPush(chainTxID, namedRecord(t, "message", "general", "", "Closing six now..."))
	if !ok {
		t.Fatal("record not addressed")
	}
	want := `{"class":"message","txid":"` + chainTxID + `","ts":1758700000,"title":"Message in general"}`
	if got := wireJSON(t, p); got != want {
		t.Fatalf("push = %s, want %s", got, want)
	}
}

func TestAMessageNamingNoChannelHasNoTitleSoTheClassTitleStands(t *testing.T) {
	p, _ := recordPush("direct:ab", namedRecord(t, "message", "", "", "Closing six now..."))
	if p.Title != "" {
		t.Fatalf("title = %q, want none", p.Title)
	}
}

func TestAnOverlongChannelNameIsCutInTheTitle(t *testing.T) {
	long := ""
	for i := 0; i < 100; i++ {
		long += "é"
	}
	p, _ := recordPush("direct:ab", namedRecord(t, "message", long, "", ""))
	if got, want := len([]rune(p.Title)), len("Message in ")+maxSummaryRunes; got != want {
		t.Fatalf("title = %d runes, want %d", got, want)
	}
}

func TestAnEmergencyStillCarriesOnlyTheEmergencyTitle(t *testing.T) {
	raw := eventsRecord(t, "emergency", "never shown")
	var fields map[string]any
	_ = json.Unmarshal(raw, &fields)
	fields["channel"] = "general"
	fields["bead"] = "mw-gq6.251"
	raw, _ = json.Marshal(fields)
	p, _ := recordPush("direct:ab", raw)
	want := `{"class":"events","txid":"direct:ab","ts":1758700000,"title":"Emergency"}`
	if got := wireJSON(t, p); got != want {
		t.Fatalf("emergency push = %s, want %s", got, want)
	}
}

func TestAGristRecordNeverPushesItsSummaryOrNamesAChannel(t *testing.T) {
	p, _ := recordPush("direct:ab", namedRecord(t, "grist", "general", "mw-gq6.251", "private work"))
	if got, want := wireJSON(t, p), `{"class":"grist","txid":"direct:ab","ts":1758700000}`; got != want {
		t.Fatalf("push = %s, want exactly %s", got, want)
	}
}

func TestOtherClassesKeepTheirOwnTitleEvenWhenAChannelIsNamed(t *testing.T) {
	for _, class := range []string{"decision-needed", "landing", "alarm"} {
		p, _ := recordPush("direct:ab", namedRecord(t, class, "general", "mw-gq6.251", "x"))
		if p.Title != "" {
			t.Fatalf("%s: title = %q, the class keeps its own title", class, p.Title)
		}
	}
}
