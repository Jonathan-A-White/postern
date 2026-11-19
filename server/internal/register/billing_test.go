package register

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// AC1 (mw-cvwm1u.22): a person's billing mark is "max" until the Governor
// marks it "api"; the mark is kept on the person, shared by every device,
// stored, and read back by Person.
func TestAPersonIsBilledMaxUntilMarkedAPI(t *testing.T) {
	s, _, _, _ := newService(t)
	if _, err := register(t, s, email1, phone1, deviceKey(0)); err != nil {
		t.Fatal(err)
	}
	if _, err := register(t, s, email2, phone1, deviceKey(1)); err != nil {
		t.Fatal(err)
	}
	if person, _ := s.Person(deviceKey(0)); person.Billing != "max" {
		t.Fatalf("a new person's billing = %q, want max", person.Billing)
	}
	if err := s.SetBilling(deviceKey(0), "api"); err != nil {
		t.Fatalf("SetBilling: %v", err)
	}
	for _, key := range []string{deviceKey(0), deviceKey(1)} {
		if person, _ := s.Person(key); person.Billing != "api" {
			t.Fatalf("device %s: billing = %q, want api on every device of the person", key[:4], person.Billing)
		}
	}
	if err := s.SetBilling(deviceKey(1), "max"); err != nil {
		t.Fatal(err)
	}
	if person, _ := s.Person(deviceKey(0)); person.Billing != "max" {
		t.Fatalf("billing = %q after setting max, want max", person.Billing)
	}
}

func TestBillingIsOnlyMaxOrAPI(t *testing.T) {
	s, _, _, _ := newService(t)
	for _, bad := range []string{"", "MAX2", "free", "api "} {
		err := s.SetBilling(deviceKey(0), bad)
		var invalid *InvalidError
		if err == nil || !errors.As(err, &invalid) {
			t.Fatalf("SetBilling(%q) = %v, want an InvalidError", bad, err)
		}
	}
	if err := s.SetBilling("nonsense", "api"); err == nil {
		t.Fatal("a bad key was accepted")
	}
}

// The mark is stored: a reopened service reads it, and a person file written
// before the field existed reads as max.
func TestBillingSurvivesAReopenAndAnOldRecordReadsMax(t *testing.T) {
	s, v, c, dir := newService(t)
	if _, err := register(t, s, email1, phone1, deviceKey(0)); err != nil {
		t.Fatal(err)
	}
	if _, err := register(t, s, email3, phone2, deviceKey(2)); err != nil {
		t.Fatal(err)
	}
	if err := s.SetBilling(deviceKey(0), "api"); err != nil {
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
	if person, _ := again.Person(deviceKey(0)); person.Billing != "api" {
		t.Fatalf("after reopening, billing = %q, want api", person.Billing)
	}
	if person, _ := again.Person(deviceKey(2)); person.Billing != "max" {
		t.Fatalf("a record with no mark reads %q, want max", person.Billing)
	}
}

// Every other write of a person (a device renamed, removed, seen, joined)
// keeps the mark.
func TestBillingIsKeptWhenThePersonChanges(t *testing.T) {
	s, _, c, _ := newService(t)
	if _, err := register(t, s, email1, phone1, deviceKey(0)); err != nil {
		t.Fatal(err)
	}
	if err := s.SetBilling(deviceKey(0), "api"); err != nil {
		t.Fatal(err)
	}
	second, err := register(t, s, email2, phone1, deviceKey(1))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.RenameDevice(deviceKey(0), deviceKey(1), "Tablet"); err != nil {
		t.Fatal(err)
	}
	c.Advance(2 * SeenEvery)
	s.Seen(deviceKey(0))
	if _, err := s.RemoveDevice(second.PersonID, deviceKey(0), deviceKey(1)); err != nil {
		t.Fatal(err)
	}
	if person, _ := s.Person(deviceKey(0)); person.Billing != "api" {
		t.Fatalf("billing = %q after rename, seen, join and remove; want api", person.Billing)
	}
}

// A key the Governor marks that no one registered keeps its mark apart, is
// listed with the others, and a person made later from that key starts there.
func TestAMarkOnAKeyWithNoPersonIsKeptAndAdoptedOnJoin(t *testing.T) {
	s, v, c, dir := newService(t)
	if err := s.SetBilling(deviceKey(3), "api"); err != nil {
		t.Fatalf("SetBilling on an unregistered key: %v", err)
	}
	if got := s.KeyBilling(deviceKey(3)); got != "api" {
		t.Fatalf("KeyBilling = %q, want api", got)
	}
	if got := s.KeyBilling(deviceKey(4)); got != "max" {
		t.Fatalf("an unmarked key reads %q, want max", got)
	}
	if _, ok := s.Person(deviceKey(3)); ok {
		t.Fatal("a mark made a person")
	}
	again, err := Open(dir, WithVerifier(v), WithIssuer(&stubIssuer{}), WithClock(c.Now))
	if err != nil {
		t.Fatal(err)
	}
	if got := again.KeyBilling(deviceKey(3)); got != "api" {
		t.Fatalf("after reopening KeyBilling = %q, want api", got)
	}
	if _, err := register(t, again, email1, phone1, deviceKey(3)); err != nil {
		t.Fatal(err)
	}
	if person, _ := again.Person(deviceKey(3)); person.Billing != "api" {
		t.Fatalf("the person made from a marked key bills %q, want api", person.Billing)
	}
	// Once a person holds the key, the person's mark is the one that counts.
	if err := again.SetBilling(deviceKey(3), "max"); err != nil {
		t.Fatal(err)
	}
	if got := again.KeyBilling(deviceKey(3)); got != "max" {
		t.Fatalf("KeyBilling = %q after the person was set max, want max", got)
	}
	if marks := again.APIKeys(); len(marks) != 0 {
		t.Fatalf("APIKeys = %v, want none", marks)
	}
}

func TestAPIKeysListsEveryKeyBilledAPI(t *testing.T) {
	s, _, _, _ := newService(t)
	register(t, s, email1, phone1, deviceKey(0))
	register(t, s, email2, phone1, deviceKey(1))
	register(t, s, email3, phone2, deviceKey(2))
	if err := s.SetBilling(deviceKey(1), "api"); err != nil {
		t.Fatal(err)
	}
	if err := s.SetBilling(deviceKey(5), "api"); err != nil {
		t.Fatal(err)
	}
	got := s.APIKeys()
	if len(got) != 3 || !got[deviceKey(0)] || !got[deviceKey(1)] || !got[deviceKey(5)] || got[deviceKey(2)] {
		t.Fatalf("APIKeys = %v, want the two devices of the marked person and the marked stranger", got)
	}
}
