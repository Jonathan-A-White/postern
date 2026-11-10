package alerts

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

type clock struct{ now time.Time }

func (c *clock) Now() time.Time { return c.now }

func openStore(t *testing.T, dir string, c *clock) *Store {
	t.Helper()
	s, err := OpenStore(dir, WithClock(c.Now))
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	return s
}

func newClock() *clock { return &clock{now: time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)} }

func TestAddressIsARandomTwelveCharTokenKeptPerFamily(t *testing.T) {
	s := openStore(t, t.TempDir(), newClock())
	first, err := s.Address("family-a")
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^[a-z2-7]{12}$`).MatchString(first) {
		t.Fatalf("token = %q, want 12 characters of a-z and 2-7", first)
	}
	again, _ := s.Address("family-a")
	other, _ := s.Address("family-b")
	if again != first || other == first {
		t.Fatalf("a family's token = %q then %q, another's %q; want the same twice and a different one", first, again, other)
	}
	if family, ok := s.FamilyOf(first); !ok || family != "family-a" {
		t.Fatalf("FamilyOf(%q) = %q, %v", first, family, ok)
	}
	if _, ok := s.FamilyOf("nonesuchtoken"); ok {
		t.Fatal("an unknown token named a family")
	}
}

func TestAnAddedAlertIsListedForItsFamilyOnlyAndSurvivesARestart(t *testing.T) {
	dir, c := t.TempDir(), newClock()
	s := openStore(t, dir, c)
	token, _ := s.Address("family-a")
	other, _ := s.Address("family-b")

	added, family, err := s.Add(token, Alert{Kind: KindCharge, Amount: "42.17", Merchant: "Corner Cafe", Last4: "1234", When: "2026-10-30T11:58:00Z"})
	if err != nil || family != "family-a" || added.ID == "" || added.Seq == 0 {
		t.Fatalf("Add = %+v, %q, %v", added, family, err)
	}
	if _, _, err := s.Add(other, Alert{Kind: KindUnread, Subject: "Hello"}); err != nil {
		t.Fatal(err)
	}

	got := s.List("family-a", 0)
	if len(got) != 1 || got[0] != added {
		t.Fatalf("family-a list = %+v, want %+v", got, added)
	}
	if s.List("family-a", added.Seq) != nil && len(s.List("family-a", added.Seq)) != 0 {
		t.Fatal("since=seq listed the alert at that seq again")
	}

	reopened := openStore(t, dir, c)
	if got := reopened.List("family-a", 0); len(got) != 1 || got[0] != added {
		t.Fatalf("after a restart: %+v", got)
	}
	if again, _ := reopened.Address("family-a"); again != token {
		t.Fatalf("after a restart the token is %q, want %q", again, token)
	}
}

func TestAddRefusesAnUnknownTokenAndAnAlertThatIsNotParsedFacts(t *testing.T) {
	s := openStore(t, t.TempDir(), newClock())
	token, _ := s.Address("family-a")

	if _, _, err := s.Add("nonesuchtoken", Alert{Kind: KindCharge}); !errors.Is(err, ErrUnknownToken) {
		t.Fatalf("unknown token: %v, want ErrUnknownToken", err)
	}
	for name, a := range map[string]Alert{
		"no kind":        {},
		"a made-up kind": {Kind: "newsletter"},
		"a bad when":     {Kind: KindCharge, When: "yesterday"},
		"a mail body":    {Kind: KindUnread, Subject: strings.Repeat("x", MaxFieldRunes+1)},
		"a long last4":   {Kind: KindCharge, Last4: "12345"},
		"a long memo":    {Kind: KindZelleSent, Memo: strings.Repeat("x", MaxFieldRunes+1)},
		"a long link":    {Kind: KindForwardConfirm, Link: "https://mail.google.com/mail/vf-" + strings.Repeat("a", MaxLinkRunes)},
		"another host":   {Kind: KindForwardConfirm, Link: "https://evil.example/mail/vf-%5BX%5D--y"},
		"a cancel link":  {Kind: KindForwardConfirm, Link: "https://mail.google.com/mail/uf-%5BX%5D--y"},
	} {
		var invalid *InvalidError
		if _, _, err := s.Add(token, a); !errors.As(err, &invalid) {
			t.Fatalf("%s: %v, want an InvalidError", name, err)
		}
	}
	if got := s.List("family-a", 0); len(got) != 0 {
		t.Fatalf("a refused alert was kept: %+v", got)
	}
}

func TestClaimDeletesTheAlertForTheFamilyAndOnlyTheFamily(t *testing.T) {
	s := openStore(t, t.TempDir(), newClock())
	token, _ := s.Address("family-a")
	s.Address("family-b")
	added, _, _ := s.Add(token, Alert{Kind: KindAmazon, Merchant: "Amazon"})

	if found, _ := s.Claim("family-b", added.ID); found {
		t.Fatal("another family claimed the alert")
	}
	if found, err := s.Claim("family-a", added.ID); !found || err != nil {
		t.Fatalf("the family could not claim its alert: %v, %v", found, err)
	}
	if got := s.List("family-a", 0); len(got) != 0 {
		t.Fatalf("a claimed alert is still listed: %+v", got)
	}
	if found, _ := s.Claim("family-a", added.ID); found {
		t.Fatal("a claimed alert was claimed twice")
	}
}

func TestSweepDropsAlertsOlderThanThirtyDays(t *testing.T) {
	dir, c := t.TempDir(), newClock()
	s := openStore(t, dir, c)
	token, _ := s.Address("family-a")
	old, _, _ := s.Add(token, Alert{Kind: KindCharge, Amount: "1.00", Merchant: "Old"})

	c.now = c.now.Add(29 * 24 * time.Hour)
	fresh, _, _ := s.Add(token, Alert{Kind: KindCharge, Amount: "2.00", Merchant: "Fresh"})
	if n, err := s.Sweep(); err != nil || n != 0 {
		t.Fatalf("at 29 days Sweep = %d, %v, want nothing dropped", n, err)
	}

	c.now = c.now.Add(2 * 24 * time.Hour) // old is now 31 days old, fresh 2
	if n, err := s.Sweep(); err != nil || n != 1 {
		t.Fatalf("at 31 days Sweep = %d, %v, want the old alert dropped", n, err)
	}
	got := s.List("family-a", 0)
	if len(got) != 1 || got[0].ID != fresh.ID || got[0].ID == old.ID {
		t.Fatalf("after the sweep: %+v, want only the fresh alert", got)
	}
	if reopened := openStore(t, dir, c); len(reopened.List("family-a", 0)) != 1 {
		t.Fatal("the sweep was not written to disk")
	}
	// the family keeps its address after its alerts are gone
	if again, _ := s.Address("family-a"); again != token {
		t.Fatalf("token changed to %q", again)
	}
}

func TestSeqNeverGoesBackAfterAClaim(t *testing.T) {
	s := openStore(t, t.TempDir(), newClock())
	token, _ := s.Address("family-a")
	a, _, _ := s.Add(token, Alert{Kind: KindUnread, Subject: "one"})
	s.Claim("family-a", a.ID)
	b, _, _ := s.Add(token, Alert{Kind: KindUnread, Subject: "two"})
	if b.Seq <= a.Seq {
		t.Fatalf("seq %d after %d", b.Seq, a.Seq)
	}
}

func TestAConfirmLinkIsKeptListedAndSurvivesARestart(t *testing.T) {
	dir, c := t.TempDir(), newClock()
	s := openStore(t, dir, c)
	token, _ := s.Address("family-a")
	link := "https://mail.google.com/mail/vf-%5BMADE-UP%5D--" + strings.Repeat("a", MaxFieldRunes)
	added, _, err := s.Add(token, Alert{Kind: KindForwardConfirm, Link: link})
	if err != nil {
		t.Fatalf("Add: %v (a real link is longer than a text field)", err)
	}
	if got := openStore(t, dir, c).List("family-a", 0); len(got) != 1 || got[0] != added || got[0].Link != link {
		t.Fatalf("after a restart: %+v", got)
	}
}

func TestAnAlertsFileFromBeforeLinksStillLoads(t *testing.T) {
	dir := t.TempDir()
	old := `{"nextSeq":1,"addresses":{"family-a":"abcdefghijkl"},"alerts":[{"id":"0123456789abcdef","seq":1,"kind":"unread","subject":"(Gmail Forwarding Confirmation","family":"family-a","receivedAt":"2026-11-03T20:12:00Z"}]}`
	if err := os.WriteFile(filepath.Join(dir, fileName), []byte(old), 0o600); err != nil {
		t.Fatal(err)
	}
	got := openStore(t, dir, newClock()).List("family-a", 0)
	if len(got) != 1 || got[0].Kind != KindUnread || got[0].Link != "" {
		t.Fatalf("old file: %+v", got)
	}
	raw, _ := json.Marshal(got[0])
	if strings.Contains(string(raw), "link") {
		t.Fatalf("an alert with no link answers one: %s", raw)
	}
}

func TestAZelleSentAndADepositAreKeptWithTheirMemoAndSurviveARestart(t *testing.T) {
	dir, c := t.TempDir(), newClock()
	s := openStore(t, dir, c)
	token, _ := s.Address("family-a")
	sent, _, err := s.Add(token, Alert{Kind: KindZelleSent, Amount: "25.00", Merchant: "Sam Example", Last4: "5678", Memo: "Example lawn care", When: "2026-11-02T11:34:07-05:00"})
	if err != nil {
		t.Fatalf("Add zelle-sent: %v", err)
	}
	deposit, _, err := s.Add(token, Alert{Kind: KindDeposit, Amount: "64.20", Merchant: "ACH DEP EXAMPLE", Last4: "5678"})
	if err != nil {
		t.Fatalf("Add deposit: %v", err)
	}
	got := openStore(t, dir, c).List("family-a", 0)
	if len(got) != 2 || got[0] != sent || got[1] != deposit || got[0].Memo != "Example lawn care" {
		t.Fatalf("after a restart: %+v", got)
	}
	raw, _ := json.Marshal(deposit)
	if strings.Contains(string(raw), "memo") {
		t.Fatalf("an alert with no memo answers one: %s", raw)
	}
}

func TestASermonNotesAlertIsKeptWithItsTitleReferenceAndDateAndSurvivesARestart(t *testing.T) {
	dir, c := t.TempDir(), newClock()
	s := openStore(t, dir, c)
	token, _ := s.Address("sermons")
	notes, _, err := s.Add(token, Alert{Kind: KindSermonNotes, Title: "The Day of the Lord", Reference: "2 Peter 3:10-18", When: "2026-11-08T00:00:00-05:00"})
	if err != nil {
		t.Fatalf("Add sermon-notes: %v", err)
	}
	got := openStore(t, dir, c).List("sermons", 0)
	if len(got) != 1 || got[0] != notes || got[0].Title != "The Day of the Lord" || got[0].Reference != "2 Peter 3:10-18" {
		t.Fatalf("after a restart: %+v", got)
	}
	if _, _, err := s.Add(token, Alert{Kind: KindSermonNotes, Title: strings.Repeat("t", MaxFieldRunes+1)}); err == nil {
		t.Fatal("an over-long title was kept")
	}
	if _, _, err := s.Add(token, Alert{Kind: KindSermonNotes, Reference: strings.Repeat("r", MaxFieldRunes+1)}); err == nil {
		t.Fatal("an over-long reference was kept")
	}
	raw, _ := json.Marshal(Alert{Kind: KindCharge, Amount: "1.00"})
	if strings.Contains(string(raw), "title") || strings.Contains(string(raw), "reference") {
		t.Fatalf("a charge answers a title or reference: %s", raw)
	}
}

// A confirm link is https, on one of Gmail's own hosts exactly (the ones real
// confirmations have carried: mail.google.com, mail-settings.google.com in
// 2021, isolated.mail.google.com in 2012), the /mail/vf- path, a token and
// nothing more; the cancel link (uf-) and every other host are refused.
func TestAConfirmLinkIsOnAnExactAllowListOfGmailHosts(t *testing.T) {
	for _, host := range []string{"mail.google.com", "mail-settings.google.com", "isolated.mail.google.com"} {
		if link := "https://" + host + "/mail/vf-%5BMADE-UP%5D-y_z"; !IsConfirmLink(link) {
			t.Errorf("%s refused", link)
		}
	}
	for _, link := range []string{
		"https://mail-settings.google.com/mail/uf-%5BMADE-UP%5D-y",
		"https://isolated.mail.google.com/mail/uf-0a1b-x%40example.org-tlr-y",
		"https://google.com/mail/vf-%5BMADE-UP%5D-y",
		"https://accounts.google.com/mail/vf-%5BMADE-UP%5D-y",
		"https://settings.google.com/mail/vf-%5BMADE-UP%5D-y",
		"https://evil.mail-settings.google.com/mail/vf-%5BMADE-UP%5D-y",
		"https://notmail-settings.google.com/mail/vf-%5BMADE-UP%5D-y",
		"https://isolated.mail.google.com.evil.example/mail/vf-%5BMADE-UP%5D-y",
		"https://mail-settings.google.com:8443/mail/vf-%5BMADE-UP%5D-y",
		"https://mail-settings.google.com@evil.example/mail/vf-%5BMADE-UP%5D-y",
		"http://mail-settings.google.com/mail/vf-%5BMADE-UP%5D-y",
		"https://mail-settings.google.com/mail/vf-%5BMADE-UP%5D-y?continue=https://evil.example",
		"https://mail-settings.google.com/mail/vf-%5BMADE-UP%5D-y#x",
		"https://mail-settings.google.com/settings/vf-%5BMADE-UP%5D-y",
	} {
		if IsConfirmLink(link) {
			t.Errorf("%s accepted", link)
		}
	}
	s := openStore(t, t.TempDir(), newClock())
	token, _ := s.Address("family-a")
	if _, _, err := s.Add(token, Alert{Kind: KindForwardConfirm, Link: "https://mail-settings.google.com/mail/vf-%5BMADE-UP%5D-y"}); err != nil {
		t.Fatalf("Add a mail-settings link: %v", err)
	}
}
