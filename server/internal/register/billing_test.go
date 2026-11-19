package register

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Jonathan-A-White/postern/server/internal/licence"
)

func addressOf(t *testing.T, key string) string {
	t.Helper()
	address, err := licence.AddressForPublicKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return address
}

// AC1 (mw-cvwm1u.22): a person's billing mark is "max" until the Governor
// marks it "api"; the mark is kept on the person, shared by every device,
// stored, and read back by Person.
func TestAPersonIsBilledMaxUntilMarkedAPI(t *testing.T) {
	s, _, _, _ := newService(t)
	if _, err := register(t, s, email1, phone1, realKey(0)); err != nil {
		t.Fatal(err)
	}
	if _, err := register(t, s, email2, phone1, realKey(1)); err != nil {
		t.Fatal(err)
	}
	if person, _ := s.Person(realKey(0)); person.Billing != "max" {
		t.Fatalf("a new person's billing = %q, want max", person.Billing)
	}
	if err := s.SetBilling(realKey(0), "api"); err != nil {
		t.Fatalf("SetBilling: %v", err)
	}
	for _, key := range []string{realKey(0), realKey(1)} {
		if person, _ := s.Person(key); person.Billing != "api" {
			t.Fatalf("device %s: billing = %q, want api on every device of the person", key[:4], person.Billing)
		}
	}
	if err := s.SetBilling(realKey(1), "max"); err != nil {
		t.Fatal(err)
	}
	if person, _ := s.Person(realKey(0)); person.Billing != "max" {
		t.Fatalf("billing = %q after setting max, want max", person.Billing)
	}
}

func TestBillingIsOnlyMaxOrAPI(t *testing.T) {
	s, _, _, _ := newService(t)
	for _, bad := range []string{"", "MAX2", "free", "api "} {
		err := s.SetBilling(realKey(0), bad)
		var invalid *InvalidError
		if err == nil || !errors.As(err, &invalid) {
			t.Fatalf("SetBilling(%q) = %v, want an InvalidError", bad, err)
		}
	}
	for _, bad := range []string{"nonsense", "", "02" + strings.Repeat("0", 64), "mhGrwwkeS5hg6X1zJS7xHMGBh8Wc7YyPH1"} {
		if err := s.SetBilling(bad, "api"); err == nil {
			t.Fatalf("SetBilling(%q): a bad holder was accepted", bad)
		}
	}
}

// The mark is stored: a reopened service reads it, and a person file written
// before the field existed reads as max.
func TestBillingSurvivesAReopenAndAnOldRecordReadsMax(t *testing.T) {
	s, v, c, dir := newService(t)
	if _, err := register(t, s, email1, phone1, realKey(0)); err != nil {
		t.Fatal(err)
	}
	if _, err := register(t, s, email3, phone2, realKey(2)); err != nil {
		t.Fatal(err)
	}
	if err := s.SetBilling(realKey(0), "api"); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, PeopleFile))
	if err != nil || !strings.Contains(string(raw), `"billing": "api"`) {
		t.Fatalf("the people file = %s, %v; want the api mark in it", raw, err)
	}
	if strings.Count(string(raw), `"billing"`) != 1 {
		t.Fatalf("the people file = %s; a person billed max carries no mark (it reads as max)", raw)
	}
	again, err := Open(dir, WithVerifier(v), WithIssuer(&stubIssuer{}), WithClock(c.Now))
	if err != nil {
		t.Fatal(err)
	}
	if person, _ := again.Person(realKey(0)); person.Billing != "api" {
		t.Fatalf("after reopening, billing = %q, want api", person.Billing)
	}
	if person, _ := again.Person(realKey(2)); person.Billing != "max" {
		t.Fatalf("a record with no mark reads %q, want max", person.Billing)
	}
}

// Every other write of a person (a device renamed, removed, seen, joined)
// keeps the mark.
func TestBillingIsKeptWhenThePersonChanges(t *testing.T) {
	s, _, c, _ := newService(t)
	if _, err := register(t, s, email1, phone1, realKey(0)); err != nil {
		t.Fatal(err)
	}
	if err := s.SetBilling(realKey(0), "api"); err != nil {
		t.Fatal(err)
	}
	second, err := register(t, s, email2, phone1, realKey(1))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.RenameDevice(realKey(0), realKey(1), "Tablet"); err != nil {
		t.Fatal(err)
	}
	c.Advance(2 * SeenEvery)
	s.Seen(realKey(0))
	if _, err := s.RemoveDevice(second.PersonID, realKey(0), realKey(1)); err != nil {
		t.Fatal(err)
	}
	if person, _ := s.Person(realKey(0)); person.Billing != "api" {
		t.Fatalf("billing = %q after rename, seen, join and remove; want api", person.Billing)
	}
}

// A key the Governor marks that no one registered keeps its mark apart, is
// listed with the others, and a person made later from that key starts there.
func TestAMarkOnAKeyWithNoPersonIsKeptAndAdoptedOnJoin(t *testing.T) {
	s, v, c, dir := newService(t)
	if err := s.SetBilling(realKey(3), "api"); err != nil {
		t.Fatalf("SetBilling on an unregistered key: %v", err)
	}
	if got := s.KeyBilling(realKey(3)); got != "api" {
		t.Fatalf("KeyBilling = %q, want api", got)
	}
	if got := s.KeyBilling(realKey(4)); got != "max" {
		t.Fatalf("an unmarked key reads %q, want max", got)
	}
	if _, ok := s.Person(realKey(3)); ok {
		t.Fatal("a mark made a person")
	}
	again, err := Open(dir, WithVerifier(v), WithIssuer(&stubIssuer{}), WithClock(c.Now))
	if err != nil {
		t.Fatal(err)
	}
	if got := again.KeyBilling(realKey(3)); got != "api" {
		t.Fatalf("after reopening KeyBilling = %q, want api", got)
	}
	if _, err := register(t, again, email1, phone1, realKey(3)); err != nil {
		t.Fatal(err)
	}
	if person, _ := again.Person(realKey(3)); person.Billing != "api" {
		t.Fatalf("the person made from a marked key bills %q, want api", person.Billing)
	}
	// Once a person holds the key, the person's mark is the one that counts.
	if err := again.SetBilling(realKey(3), "max"); err != nil {
		t.Fatal(err)
	}
	if got := again.KeyBilling(realKey(3)); got != "max" {
		t.Fatalf("KeyBilling = %q after the person was set max, want max", got)
	}
	if marks := again.APIHolders(); len(marks) != 0 {
		t.Fatalf("APIHolders = %v, want none", marks)
	}
}

func TestAPIHoldersListsEveryAddressBilledAPI(t *testing.T) {
	s, _, _, _ := newService(t)
	register(t, s, email1, phone1, realKey(0))
	register(t, s, email2, phone1, realKey(1))
	register(t, s, email3, phone2, realKey(2))
	// by a device's public key, as the tests and an operator may; by address, as the Key screen does
	if err := s.SetBilling(realKey(1), "api"); err != nil {
		t.Fatal(err)
	}
	if err := s.SetBilling(addressOf(t, realKey(5)), "api"); err != nil {
		t.Fatal(err)
	}
	got := s.APIHolders()
	want := []string{addressOf(t, realKey(0)), addressOf(t, realKey(1)), addressOf(t, realKey(5))}
	if len(got) != 3 || !got[want[0]] || !got[want[1]] || !got[want[2]] || got[addressOf(t, realKey(2))] {
		t.Fatalf("APIHolders = %v, want the two devices of the marked person and the marked stranger", got)
	}
}

// The Key screen names a holder by address: the mark lands on the person who
// has a key at that address.
func TestAMarkByAddressLandsOnThePersonWithThatKey(t *testing.T) {
	s, _, _, _ := newService(t)
	register(t, s, email1, phone1, realKey(0))
	register(t, s, email2, phone1, realKey(1))
	if err := s.SetBilling(addressOf(t, realKey(1)), "api"); err != nil {
		t.Fatal(err)
	}
	if person, _ := s.Person(realKey(0)); person.Billing != "api" {
		t.Fatalf("billing = %q, want api on the person with that address", person.Billing)
	}
}
