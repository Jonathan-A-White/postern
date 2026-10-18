package register

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	emailCode = "111111"
	phoneCode = "222222"

	email1 = "Ada.Lovelace@Example.com"
	email2 = "ada.second@example.org"
	email3 = "grace@example.net"
	phone1 = "+14155550101"
	phone2 = "+14155550102"
)

func deviceKey(n byte) string {
	return "02" + strings.Repeat(string([]byte{'a' + n}), 64)
}

// fakeVerifier is Twilio Verify as the tests need it: every email gets
// emailCode and every phone phoneCode, and it remembers what it was asked to
// send.
type fakeVerifier struct {
	mu       sync.Mutex
	sent     []string // "channel:to"
	checks   int
	startErr error
	checkErr error
}

func (f *fakeVerifier) Start(_ context.Context, channel Channel, to string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.startErr != nil {
		return f.startErr
	}
	f.sent = append(f.sent, string(channel)+":"+to)
	return nil
}

func (f *fakeVerifier) Check(_ context.Context, channel Channel, to, code string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.checks++
	if f.checkErr != nil {
		return false, f.checkErr
	}
	want := emailCode
	if channel == ChannelSMS {
		want = phoneCode
	}
	return code == want, nil
}

type clock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *clock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

func newService(t *testing.T) (*Service, *fakeVerifier, *clock, string) {
	t.Helper()
	dir := t.TempDir()
	v := &fakeVerifier{}
	c := &clock{now: time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)}
	s, err := Open(dir, WithVerifier(v), WithIssuer(&stubIssuer{}), WithClock(c.Now))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	return s, v, c, dir
}

// stubIssuer stands in for the site issuer where the chain is not the
// point: each licence gets a txid of its own (issue_test.go has the real one).
type stubIssuer struct {
	mu      sync.Mutex
	issued  []string
	revoked []string
}

func (s *stubIssuer) Issue(holderKey string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.issued = append(s.issued, holderKey)
	return fmt.Sprintf("%064x", len(s.issued)), nil
}

func (s *stubIssuer) Revoke(origin string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.revoked = append(s.revoked, origin)
	return fmt.Sprintf("%064x", 1000+len(s.revoked)), nil
}

// register runs start and a correct confirm.
func register(t *testing.T, s *Service, email, phone, key string) (Result, error) {
	t.Helper()
	id, err := s.Start(context.Background(), email, phone, key)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	return s.Confirm(context.Background(), id, emailCode, phoneCode, "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130")
}

func TestStartThenConfirmMakesAPersonWithOneDevice(t *testing.T) {
	s, v, _, _ := newService(t)
	res, err := register(t, s, email1, phone1, deviceKey(0))
	if err != nil {
		t.Fatalf("Confirm: %v", err)
	}
	if res.PersonID == "" || len(res.Devices) != 1 || res.Devices[0].Key != deviceKey(0) {
		t.Fatalf("result = %+v, want one person with the device", res)
	}
	if res.Devices[0].Name == "" || res.Devices[0].AddedAt.IsZero() {
		t.Fatalf("device = %+v, want a name and a time", res.Devices[0])
	}
	if !res.Issued || res.Devices[0].LicenceTxid == "" {
		t.Fatal("the new device was not issued a licence")
	}
	if len(v.sent) != 2 {
		t.Fatalf("sent %v, want a code to the email and one to the phone", v.sent)
	}
	person, ok := s.Person(deviceKey(0))
	if !ok || person.PersonID != res.PersonID || person.DailyLimit != 50 || len(person.Keys) != 1 {
		t.Fatalf("Person = %+v, %v", person, ok)
	}
}

func TestSecondDeviceWithTheSamePhoneJoinsTheSamePerson(t *testing.T) {
	s, _, _, _ := newService(t)
	first, err := register(t, s, email1, phone1, deviceKey(0))
	if err != nil {
		t.Fatal(err)
	}
	second, err := register(t, s, email2, phone1, deviceKey(1))
	if err != nil {
		t.Fatalf("second device: %v", err)
	}
	if second.PersonID != first.PersonID || len(second.Devices) != 2 {
		t.Fatalf("second = %+v, want the same person with two devices", second)
	}
	person, _ := s.Person(deviceKey(1))
	if len(person.Keys) != 2 {
		t.Fatalf("keys = %v, want both devices", person.Keys)
	}
}

func TestAnEmailAlreadyAnotherPersonsIsRefused(t *testing.T) {
	s, _, _, _ := newService(t)
	if _, err := register(t, s, email1, phone1, deviceKey(0)); err != nil {
		t.Fatal(err)
	}
	// A new phone with an email that is the first person's.
	_, err := register(t, s, "  ADA.LOVELACE@example.com ", phone2, deviceKey(1))
	if !errors.Is(err, ErrEmailTaken) || err.Error() != "that email is already registered" {
		t.Fatalf("new phone, known email: err = %v, want ErrEmailTaken", err)
	}
	// A second person, then the first person's phone with the second's email.
	if _, err := register(t, s, email3, phone2, deviceKey(2)); err != nil {
		t.Fatal(err)
	}
	_, err = register(t, s, email3, phone1, deviceKey(3))
	if !errors.Is(err, ErrEmailTaken) {
		t.Fatalf("known phone, another person's email: err = %v, want ErrEmailTaken", err)
	}
	// An email a joining device used is that person's too.
	if _, err := register(t, s, email2, phone1, deviceKey(4)); err != nil {
		t.Fatal(err)
	}
	if _, err := register(t, s, email2, phone2, deviceKey(5)); !errors.Is(err, ErrEmailTaken) {
		t.Fatalf("an email a joining device used: err = %v, want ErrEmailTaken", err)
	}
}

func TestAFourthDeviceIsRefusedWithTheExactMessage(t *testing.T) {
	s, _, c, _ := newService(t)
	for i := byte(0); i < 3; i++ {
		if _, err := register(t, s, email1, phone1, deviceKey(i)); err != nil {
			t.Fatalf("device %d: %v", i, err)
		}
	}
	c.Advance(time.Hour) // a phone has codes sent at most 3 times an hour
	_, err := register(t, s, email1, phone1, deviceKey(3))
	if !errors.Is(err, ErrFull) || err.Error() != "This licence already has 3 devices. Remove one first." {
		t.Fatalf("fourth device: err = %v", err)
	}
	person, _ := s.Person(deviceKey(0))
	if len(person.Keys) != 3 {
		t.Fatalf("keys = %v, want still three", person.Keys)
	}
	// A device already on the licence registering again is not a fourth.
	res, err := register(t, s, email1, phone1, deviceKey(1))
	if err != nil || len(res.Devices) != 3 {
		t.Fatalf("again: %+v, %v", res, err)
	}
}

func TestADeviceOfAnotherPersonIsRefused(t *testing.T) {
	s, _, _, _ := newService(t)
	if _, err := register(t, s, email1, phone1, deviceKey(0)); err != nil {
		t.Fatal(err)
	}
	_, err := register(t, s, email3, phone2, deviceKey(0))
	if !errors.Is(err, ErrDeviceTaken) {
		t.Fatalf("err = %v, want ErrDeviceTaken", err)
	}
}

func TestFiveWrongCodesEndTheRegistration(t *testing.T) {
	s, _, _, _ := newService(t)
	ctx := context.Background()
	id, err := s.Start(ctx, email1, phone1, deviceKey(0))
	if err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 5; i++ {
		_, err := s.Confirm(ctx, id, "000000", phoneCode, "")
		var wrong *WrongCodeError
		if !errors.As(err, &wrong) || wrong.TriesLeft != 5-i {
			t.Fatalf("try %d: err = %v, want a wrong code with %d left", i, err, 5-i)
		}
	}
	if _, err := s.Confirm(ctx, id, emailCode, phoneCode, ""); !errors.Is(err, ErrGone) {
		t.Fatalf("after five wrong tries, right codes: err = %v, want ErrGone", err)
	}
	if _, ok := s.Person(deviceKey(0)); ok {
		t.Fatal("a person was made by a dead registration")
	}
}

func TestACodeRightOnOneChannelIsNotAskedAgain(t *testing.T) {
	s, v, _, _ := newService(t)
	ctx := context.Background()
	id, _ := s.Start(ctx, email1, phone1, deviceKey(0))
	if _, err := s.Confirm(ctx, id, emailCode, "999999", ""); err == nil {
		t.Fatal("a wrong phone code was accepted")
	}
	before := v.checks
	// Twilio will not check an approved verification twice: the email code
	// is not sent again, and need not be.
	if _, err := s.Confirm(ctx, id, "", phoneCode, ""); err != nil {
		t.Fatalf("second try: %v", err)
	}
	if v.checks-before != 1 {
		t.Fatalf("checks = %d, want only the phone checked again", v.checks-before)
	}
}

func TestAnExpiredRegistrationIsRefused(t *testing.T) {
	s, _, c, _ := newService(t)
	ctx := context.Background()
	id, _ := s.Start(ctx, email1, phone1, deviceKey(0))
	c.Advance(10*time.Minute + time.Second)
	if _, err := s.Confirm(ctx, id, emailCode, phoneCode, ""); !errors.Is(err, ErrGone) {
		t.Fatalf("err = %v, want ErrGone", err)
	}
	// Just inside the ten minutes still works.
	id, _ = s.Start(ctx, email1, phone1, deviceKey(0))
	c.Advance(9*time.Minute + 59*time.Second)
	if _, err := s.Confirm(ctx, id, emailCode, phoneCode, ""); err != nil {
		t.Fatalf("inside the window: %v", err)
	}
}

func TestAnUnknownRegistrationIsRefused(t *testing.T) {
	s, _, _, _ := newService(t)
	if _, err := s.Confirm(context.Background(), "nope", emailCode, phoneCode, ""); !errors.Is(err, ErrGone) {
		t.Fatalf("err = %v, want ErrGone", err)
	}
}

func TestStartRefusesWhatIsNotAnEmailAPhoneOrAKey(t *testing.T) {
	s, v, _, _ := newService(t)
	ctx := context.Background()
	for _, tc := range []struct{ name, email, phone, key string }{
		{"no at", "ada.example.com", phone1, deviceKey(0)},
		{"empty email", "", phone1, deviceKey(0)},
		{"no plus", email1, "4155550101", deviceKey(0)},
		{"short phone", email1, "+1415", deviceKey(0)},
		{"letters in phone", email1, "+1415555abcd", deviceKey(0)},
		{"short key", email1, phone1, "02abcd"},
		{"uncompressed prefix", email1, phone1, "04" + strings.Repeat("a", 64)},
		{"not hex", email1, phone1, "02" + strings.Repeat("z", 64)},
	} {
		_, err := s.Start(ctx, tc.email, tc.phone, tc.key)
		var invalid *InvalidError
		if !errors.As(err, &invalid) {
			t.Errorf("%s: err = %v, want InvalidError", tc.name, err)
		}
	}
	if len(v.sent) != 0 {
		t.Fatalf("sent %v for bad input", v.sent)
	}
	// A phone written the way people write it is read as E.164.
	if _, err := s.Start(ctx, email1, "+1 (415) 555-0101", deviceKey(0)); err != nil {
		t.Fatalf("a formatted phone: %v", err)
	}
	if v.sent[1] != "sms:+14155550101" {
		t.Fatalf("sent %v, want the E.164 phone", v.sent)
	}
}

func TestStartReportsWhenTwilioRejectsTheDestination(t *testing.T) {
	s, v, _, _ := newService(t)
	v.startErr = ErrRejected
	_, err := s.Start(context.Background(), email1, phone1, deviceKey(0))
	if !errors.Is(err, ErrRejected) {
		t.Fatalf("err = %v, want ErrRejected", err)
	}
}

func TestWithoutAVerifierRegistrationIsClosed(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if s.Open() {
		t.Fatal("Open() = true with no verifier")
	}
	if _, err := s.Start(context.Background(), email1, phone1, deviceKey(0)); !errors.Is(err, ErrClosed) {
		t.Fatalf("Start err = %v, want ErrClosed", err)
	}
	if _, err := s.Confirm(context.Background(), "x", "1", "2", ""); !errors.Is(err, ErrClosed) {
		t.Fatalf("Confirm err = %v, want ErrClosed", err)
	}
	if _, ok := s.Person(deviceKey(0)); ok {
		t.Fatal("a stranger is known")
	}
}

func TestPeopleSurviveARestartAndKeepTheirFingerprints(t *testing.T) {
	s, v, c, dir := newService(t)
	first, err := register(t, s, email1, phone1, deviceKey(0))
	if err != nil {
		t.Fatal(err)
	}
	again, err := Open(dir, WithVerifier(v), WithIssuer(&stubIssuer{}), WithClock(c.Now))
	if err != nil {
		t.Fatal(err)
	}
	res, err := register(t, again, email2, phone1, deviceKey(1))
	if err != nil || res.PersonID != first.PersonID || len(res.Devices) != 2 {
		t.Fatalf("after restart: %+v, %v (the key must survive too)", res, err)
	}
}

func TestStorageAndLogHoldFingerprintsOnly(t *testing.T) {
	var logged bytes.Buffer
	log.SetOutput(&logged)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	s, _, _, dir := newService(t)
	if _, err := register(t, s, email1, phone1, deviceKey(0)); err != nil {
		t.Fatal(err)
	}
	if _, err := register(t, s, email2, phone1, deviceKey(1)); err != nil {
		t.Fatal(err)
	}
	// A refusal logs too, perhaps.
	_, _ = register(t, s, email1, phone2, deviceKey(2))

	files := 0
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		files++
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		text := strings.ToLower(string(data))
		for _, secret := range []string{email1, email2, "lovelace", "example.com", "example.org", phone1, phone2, "4155550101", "4155550102"} {
			if strings.Contains(text, strings.ToLower(secret)) {
				t.Errorf("%s holds %q in clear", filepath.Base(path), secret)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if files < 2 {
		t.Fatalf("found %d files under the data dir, want the people file and the key", files)
	}
	for _, secret := range []string{email1, email2, "lovelace", phone1, phone2, "4155550101"} {
		if strings.Contains(strings.ToLower(logged.String()), strings.ToLower(secret)) {
			t.Errorf("the log holds %q: %s", secret, logged.String())
		}
	}
	people, err := os.ReadFile(filepath.Join(dir, PeopleFile))
	if err != nil || !strings.Contains(string(people), `"fpE"`) || !strings.Contains(string(people), `"fpP"`) {
		t.Fatalf("people file = %s, %v; want fingerprints", people, err)
	}
}

func TestFingerprintsIgnoreCaseAndSpacesAndFollowTheKey(t *testing.T) {
	s, _, _, _ := newService(t)
	if s.fpEmail(" Ada@X.com ") != s.fpEmail("ada@x.com") {
		t.Fatal("email fingerprints differ by case or spacing")
	}
	if s.fpEmail("a@x.com") == s.fpPhone("+14155550101") {
		t.Fatal("an email and a phone share a fingerprint")
	}
	other, _, _, _ := newService(t) // another data dir, another key
	if s.fpEmail("a@x.com") == other.fpEmail("a@x.com") {
		t.Fatal("fingerprints do not depend on the key")
	}
}

func TestLimiterAllowsTenStartsAnHourPerIP(t *testing.T) {
	s, _, c, _ := newService(t)
	for i := 0; i < 10; i++ {
		if !s.AllowStart("203.0.113.9") {
			t.Fatalf("start %d refused", i+1)
		}
	}
	if s.AllowStart("203.0.113.9") {
		t.Fatal("the 11th start was allowed")
	}
	if !s.AllowStart("203.0.113.10") {
		t.Fatal("another IP was refused")
	}
	c.Advance(time.Hour + time.Second)
	if !s.AllowStart("203.0.113.9") {
		t.Fatal("the hour passed and the IP is still refused")
	}
	for i := 0; i < 30; i++ {
		if !s.AllowConfirm("203.0.113.9") {
			t.Fatalf("confirm %d refused", i+1)
		}
	}
	if s.AllowConfirm("203.0.113.9") {
		t.Fatal("the 31st confirm was allowed")
	}
}

func TestLimitsAreKnobs(t *testing.T) {
	c := &clock{now: time.Unix(1_700_000_000, 0)}
	s, err := Open(t.TempDir(), WithClock(c.Now), WithLimits(2, 3))
	if err != nil {
		t.Fatal(err)
	}
	if !s.AllowStart("a") || !s.AllowStart("a") || s.AllowStart("a") {
		t.Fatal("starts per hour is not 2")
	}
	if !s.AllowConfirm("a") || !s.AllowConfirm("a") || !s.AllowConfirm("a") || s.AllowConfirm("a") {
		t.Fatal("confirms per hour is not 3")
	}
}

func TestPersonOfAStrangerIsUnknown(t *testing.T) {
	s, _, _, _ := newService(t)
	if _, ok := s.Person(deviceKey(7)); ok {
		t.Fatal("a stranger is known")
	}
	if _, ok := s.Person("not a key"); ok {
		t.Fatal("a malformed key is known")
	}
}

func TestDeviceNamesComeFromTheUserAgentOrAreNumbered(t *testing.T) {
	for ua, want := range map[string]string{
		"Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130":           "Android phone",
		"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari": "iPhone",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130":          "Windows computer",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari":        "Mac",
		"curl/8.0": "Device 3",
		"":         "Device 3",
	} {
		if got := deviceName(ua, 3); got != want {
			t.Errorf("deviceName(%q) = %q, want %q", ua, got, want)
		}
	}
}

// numberedKey is a valid compressed key for any i (deviceKey's run out at f).
func numberedKey(i int) string { return fmt.Sprintf("02%064x", i+1) }

// sentTo counts the codes the fake was asked to send to "channel:to".
func (f *fakeVerifier) sentTo(dest string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, s := range f.sent {
		if s == dest {
			n++
		}
	}
	return n
}

// AC1 (mw-cvwm1u.9): a destination has codes sent to it at most 3 times an
// hour and 10 a day, however many callers ask; the refusal sends nothing, not
// even to the other destination, and logs no address.
func TestADestinationGetsAtMostThreeStartsAnHourAndTenADay(t *testing.T) {
	var logged bytes.Buffer
	log.SetOutput(&logged)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	ctx := context.Background()
	for _, tc := range []struct {
		name         string
		email, phone func(i int) string
		dest         string
	}{
		{"phone", func(i int) string { return fmt.Sprintf("p%d@example.com", i) }, func(int) string { return phone1 }, "sms:" + phone1},
		{"email", func(int) string { return "same@example.com" }, func(i int) string { return fmt.Sprintf("+1415555%04d", 200+i) }, "email:same@example.com"},
	} {
		s, v, c, _ := newService(t)
		start := func(i int) error {
			_, err := s.Start(ctx, tc.email(i), tc.phone(i), numberedKey(i))
			return err
		}
		for i := 0; i < 3; i++ {
			if err := start(i); err != nil {
				t.Fatalf("%s: start %d: %v", tc.name, i+1, err)
			}
		}
		if err := start(3); !errors.Is(err, ErrTooMany) {
			t.Fatalf("%s: 4th start in an hour: err = %v, want ErrTooMany", tc.name, err)
		}
		if n := v.sentTo(tc.dest); n != 3 {
			t.Fatalf("%s: %d codes sent there, want 3", tc.name, n)
		}
		if len(v.sent) != 6 {
			t.Fatalf("%s: sent %v, want nothing for the refused start", tc.name, v.sent)
		}
		// Ten a day: three an hour for three hours, then one more.
		for i := 4; i < 11; i++ {
			if (i-4)%3 == 0 {
				c.Advance(time.Hour + time.Second)
			}
			if err := start(i); err != nil {
				t.Fatalf("%s: start %d of the day: %v", tc.name, v.sentTo(tc.dest)+1, err)
			}
		}
		if n := v.sentTo(tc.dest); n != 10 {
			t.Fatalf("%s: %d codes sent there, want 10", tc.name, n)
		}
		c.Advance(time.Hour + time.Second)
		if err := start(11); !errors.Is(err, ErrTooMany) {
			t.Fatalf("%s: 11th start in a day: err = %v, want ErrTooMany", tc.name, err)
		}
		c.Advance(24 * time.Hour)
		if err := start(12); err != nil {
			t.Fatalf("%s: a day later: %v", tc.name, err)
		}
	}
	for _, secret := range []string{"example.com", "4155550101", "4155550"} {
		if strings.Contains(logged.String(), secret) {
			t.Errorf("the log holds %q: %s", secret, logged.String())
		}
	}
}

// AC1 (mw-cvwm1u.9): all callers together may start at most the send cap an
// hour; the next is refused, logged once without an address, and the hour
// after it may start again.
func TestTheGlobalSendCapRefusesTheNextStart(t *testing.T) {
	var logged bytes.Buffer
	log.SetOutput(&logged)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	dir := t.TempDir()
	v := &fakeVerifier{}
	c := &clock{now: time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)}
	s, err := Open(dir, WithVerifier(v), WithIssuer(&stubIssuer{}), WithClock(c.Now), WithSendLimits(0, 0, 5))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	start := func(i int) error {
		_, err := s.Start(ctx, fmt.Sprintf("g%d@example.com", i), fmt.Sprintf("+1415555%04d", 300+i), numberedKey(i))
		return err
	}
	for i := 0; i < 5; i++ {
		if err := start(i); err != nil {
			t.Fatalf("start %d: %v", i+1, err)
		}
	}
	for i := 5; i < 8; i++ {
		if err := start(i); !errors.Is(err, ErrSendCap) {
			t.Fatalf("start %d over the cap: err = %v, want ErrSendCap", i+1, err)
		}
	}
	if len(v.sent) != 10 {
		t.Fatalf("sent %d codes, want 10 (5 starts)", len(v.sent))
	}
	if n := strings.Count(logged.String(), "send cap"); n != 1 {
		t.Fatalf("the cap was logged %d times, want once:\n%s", n, logged.String())
	}
	if strings.Contains(logged.String(), "example.com") || strings.Contains(logged.String(), "+1415") {
		t.Fatalf("the log holds an address: %s", logged.String())
	}
	c.Advance(time.Hour + time.Second)
	if err := start(9); err != nil {
		t.Fatalf("an hour later: %v", err)
	}
}

func TestTheSendCapDefaultsTo30AnHour(t *testing.T) {
	s, _, _, _ := newService(t)
	if s.sends.limit != DefaultSendsPerHour || DefaultSendsPerHour != 30 {
		t.Fatalf("send cap = %d, want %d", s.sends.limit, DefaultSendsPerHour)
	}
}

// gateVerifier holds every Start until arrive calls have come in, or a
// moment has passed: so concurrent starts all pass whatever check comes
// before Twilio before any of them goes on.
type gateVerifier struct {
	fakeVerifier
	arrive int

	once    sync.Once
	arrived chan struct{}
	count   int
}

func (g *gateVerifier) Start(ctx context.Context, channel Channel, to string) error {
	g.mu.Lock()
	g.count++
	if g.count >= g.arrive {
		g.once.Do(func() { close(g.arrived) })
	}
	g.mu.Unlock()
	select {
	case <-g.arrived:
	case <-time.After(300 * time.Millisecond):
	}
	return g.fakeVerifier.Start(ctx, channel, to)
}

// AC4 (mw-cvwm1u.9): the pending cap is checked and the registration
// inserted under one lock, so N concurrent starts with room for N-1 leave
// exactly N-1 pending. Run it with -race too.
func TestConcurrentStartsNeverOvershootMaxPending(t *testing.T) {
	const n = 6
	s, _, _, _ := newService(t)
	gate := &gateVerifier{arrive: n, arrived: make(chan struct{})}
	s.verifier = gate
	s.maxPending = n - 1
	errs := make([]error, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = s.Start(context.Background(), fmt.Sprintf("c%d@example.com", i), fmt.Sprintf("+1415555%04d", 400+i), numberedKey(i))
		}(i)
	}
	wg.Wait()
	busy := 0
	for _, err := range errs {
		if errors.Is(err, ErrBusy) {
			busy++
		} else if err != nil {
			t.Fatalf("start: %v", err)
		}
	}
	s.mu.Lock()
	pending := len(s.pending)
	s.mu.Unlock()
	if pending != n-1 || busy != 1 {
		t.Fatalf("%d pending and %d busy, want %d pending and 1 busy", pending, busy, n-1)
	}
}

// A start Twilio could not send frees the place it held.
func TestAStartTwilioRefusedHoldsNoPlace(t *testing.T) {
	s, v, _, _ := newService(t)
	s.maxPending = 1
	v.startErr = ErrRejected
	if _, err := s.Start(context.Background(), email1, phone1, deviceKey(0)); !errors.Is(err, ErrRejected) {
		t.Fatalf("err = %v, want ErrRejected", err)
	}
	v.startErr = nil
	if _, err := s.Start(context.Background(), email2, phone2, deviceKey(1)); err != nil {
		t.Fatalf("after a refused start: %v", err)
	}
}

// AC2 (mw-cvwm1u.9): a device may see its own person, and no other.
func TestPersonForADeviceAnswersOnlyItsOwnPerson(t *testing.T) {
	s, _, c, _ := newService(t)
	if _, err := register(t, s, email1, phone1, deviceKey(0)); err != nil {
		t.Fatal(err)
	}
	c.Advance(time.Minute)
	if _, err := register(t, s, email2, phone1, deviceKey(1)); err != nil {
		t.Fatal(err)
	}
	if _, err := register(t, s, email3, phone2, deviceKey(2)); err != nil {
		t.Fatal(err)
	}
	view, err := s.PersonForDevice(deviceKey(0), deviceKey(1))
	if err != nil || len(view.Keys) != 2 || view.PersonID == "" {
		t.Fatalf("a sibling = %+v, %v", view, err)
	}
	if view, err := s.PersonForDevice(deviceKey(1), deviceKey(1)); err != nil || len(view.Keys) != 2 {
		t.Fatalf("itself = %+v, %v", view, err)
	}
	for _, tc := range []struct{ name, signer, key string }{
		{"another person's device", deviceKey(2), deviceKey(0)},
		{"asking for another person", deviceKey(0), deviceKey(2)},
		{"an unknown key", deviceKey(0), numberedKey(9)},
		{"an unknown signer", numberedKey(9), deviceKey(0)},
		{"an unknown signer and key", numberedKey(9), numberedKey(8)},
		{"not a key", deviceKey(0), "nope"},
	} {
		if view, err := s.PersonForDevice(tc.signer, tc.key); !errors.Is(err, ErrNotYours) || view.PersonID != "" {
			t.Errorf("%s = %+v, %v; want ErrNotYours and nothing", tc.name, view, err)
		}
	}
}

// AC2 (mw-cvwm1u.16): Seen stamps a registered device's lastSeen, moves it
// forward, writes no more often than SeenEvery, and ignores a key no one
// registered. The stamp survives a reopen.
func TestSeenStampsADevicesLastUse(t *testing.T) {
	s, _, c, dir := newService(t)
	if _, err := register(t, s, email1, phone1, deviceKey(0)); err != nil {
		t.Fatal(err)
	}
	key := deviceKey(0)
	first := c.Now()

	s.Seen(deviceKey(9)) // no one's: nothing happens
	view, _ := s.Person(key)
	if view.Devices[0].LastSeen != nil {
		t.Fatalf("lastSeen before any use = %v, want nil", view.Devices[0].LastSeen)
	}
	s.Seen(key)
	c.Advance(10 * time.Second)
	s.Seen(key) // within SeenEvery: not rewritten
	view, _ = s.Person(key)
	if got := view.Devices[0].LastSeen; got == nil || !got.Equal(first) {
		t.Fatalf("lastSeen = %v, want the first use, %v", got, first)
	}
	c.Advance(time.Hour)
	s.Seen(key)
	reopened, err := Open(dir, WithClock(c.Now))
	if err != nil {
		t.Fatal(err)
	}
	view, _ = reopened.Person(key)
	if got := view.Devices[0].LastSeen; got == nil || !got.Equal(c.Now()) {
		t.Fatalf("lastSeen after a reopen = %v, want %v", got, c.Now())
	}
}
