package alerts

import (
	"errors"
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

	if s.Claim("family-b", added.ID) {
		t.Fatal("another family claimed the alert")
	}
	if !s.Claim("family-a", added.ID) {
		t.Fatal("the family could not claim its alert")
	}
	if got := s.List("family-a", 0); len(got) != 0 {
		t.Fatalf("a claimed alert is still listed: %+v", got)
	}
	if s.Claim("family-a", added.ID) {
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
