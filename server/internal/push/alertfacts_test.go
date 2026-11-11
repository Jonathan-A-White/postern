package push

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	webpush "github.com/SherClockHolmes/webpush-go"
)

// A phone with a real keypair, so the test can open what was pushed to it
// (RFC 8291, aes128gcm) and read the payload as the service worker would.
type fakePhone struct {
	priv *ecdh.PrivateKey
	auth []byte
}

func newFakePhone(t *testing.T) fakePhone {
	t.Helper()
	priv, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	auth := make([]byte, 16)
	if _, err := rand.Read(auth); err != nil {
		t.Fatal(err)
	}
	return fakePhone{priv: priv, auth: auth}
}

func (p fakePhone) keys() webpush.Keys {
	return webpush.Keys{
		P256dh: base64.RawURLEncoding.EncodeToString(p.priv.PublicKey().Bytes()),
		Auth:   base64.RawURLEncoding.EncodeToString(p.auth),
	}
}

func hkdfStep(salt, ikm, info []byte, n int) []byte {
	ext := hmac.New(sha256.New, salt)
	ext.Write(ikm)
	prk := ext.Sum(nil)
	exp := hmac.New(sha256.New, prk)
	exp.Write(info)
	exp.Write([]byte{1})
	return exp.Sum(nil)[:n]
}

func (p fakePhone) open(t *testing.T, body []byte) Payload {
	t.Helper()
	salt := body[:16]
	idLen := int(body[20])
	asPub := body[21 : 21+idLen]
	cipherText := body[21+idLen:]
	as, err := ecdh.P256().NewPublicKey(asPub)
	if err != nil {
		t.Fatal(err)
	}
	secret, err := p.priv.ECDH(as)
	if err != nil {
		t.Fatal(err)
	}
	keyInfo := append([]byte("WebPush: info\x00"), p.priv.PublicKey().Bytes()...)
	keyInfo = append(keyInfo, asPub...)
	ikm := hkdfStep(p.auth, secret, keyInfo, 32)
	cek := hkdfStep(salt, ikm, []byte("Content-Encoding: aes128gcm\x00"), 16)
	nonce := hkdfStep(salt, ikm, []byte("Content-Encoding: nonce\x00"), 12)
	block, err := aes.NewCipher(cek)
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := gcm.Open(nil, nonce, cipherText, nil)
	if err != nil {
		t.Fatal(err)
	}
	plain = bytes.TrimRight(plain, "\x00")
	plain = plain[:len(plain)-1] // the 0x02 delimiter
	var out Payload
	if err := json.Unmarshal(plain, &out); err != nil {
		t.Fatalf("payload %q: %v", plain, err)
	}
	return out
}

// pushes records what each endpoint path was sent, opened by that path's phone.
type pushes struct {
	mu     sync.Mutex
	phones map[string]fakePhone
	got    map[string][]Payload
	t      *testing.T
}

func (p *pushes) handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		payload := p.phones[r.URL.Path].open(p.t, body)
		p.mu.Lock()
		p.got[r.URL.Path] = append(p.got[r.URL.Path], payload)
		p.mu.Unlock()
		w.WriteHeader(http.StatusCreated)
	}
}

// the family: Ann's two phones (cards 1111 and 2222; the second also 3333),
// Ben's (card 4444) and Cy's, which sent no list.
func alertFamily(t *testing.T) (*Sender, *pushes, *Store) {
	t.Helper()
	rec := &pushes{phones: map[string]fakePhone{}, got: map[string][]Payload{}, t: t}
	server := httptest.NewServer(rec.handler())
	t.Cleanup(server.Close)
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range []struct {
		path, key string
		last4s    []string
	}{
		{"/ann1", "ann-1", []string{"1111"}},
		{"/ann2", "ann-2", []string{"2222", "3333"}},
		{"/ben", "ben", []string{"4444"}},
		{"/cy", "cy", nil},
	} {
		phone := newFakePhone(t)
		rec.phones[s.path] = phone
		if err := store.Add(Subscription{PublicKeyHex: s.key, Endpoint: server.URL + s.path, Keys: phone.keys(), Last4s: s.last4s}); err != nil {
			t.Fatal(err)
		}
	}
	return NewSender(testKeys(t), "https://postern.allmymind.org", store), rec, store
}

var allKeys = []string{"ann-1", "ann-2", "ben", "cy"}

func charge(last4 string) AlertFacts {
	return AlertFacts{ID: "a-1", Charge: true, Amount: "42.17", Merchant: "Corner Cafe", Last4: last4}
}

func wantFull(t *testing.T, got []Payload, facts AlertFacts) {
	t.Helper()
	if len(got) != 1 {
		t.Fatalf("got %d pushes, want 1", len(got))
	}
	p := got[0]
	if p.Class != "alert" || p.Amount != facts.Amount || p.Merchant != facts.Merchant || p.Last4 != facts.Last4 || p.AlertID != facts.ID {
		t.Fatalf("push = %+v, want the charge's amount, merchant, last4 and id", p)
	}
}

func wantBare(t *testing.T, got []Payload) {
	t.Helper()
	if len(got) != 1 {
		t.Fatalf("got %d pushes, want 1", len(got))
	}
	p := got[0]
	if p.Class != "alert" || p.Title != "New alert" || p.Amount != "" || p.Merchant != "" || p.Last4 != "" || p.AlertID != "" {
		t.Fatalf("push = %+v, want the bare New alert", p)
	}
}

// Changed by mw-mr4xgrw.38: until then the lists of the other cards got the bare push here (count 4).
func wantNone(t *testing.T, got []Payload) {
	t.Helper()
	if len(got) != 0 {
		t.Fatalf("got %d pushes (%+v), want none", len(got), got)
	}
}

func TestAListedCardGetsTheChargeToItsOwnerAndNoPushToTheOtherListsAndTheBareAlertToNoList(t *testing.T) {
	sender, rec, _ := alertFamily(t)
	if sent, err := sender.NotifyAlert(allKeys, 5, charge("2222")); err != nil || sent != 2 {
		t.Fatalf("NotifyAlert = %d, %v, want 2 (the owner and the phone with no list)", sent, err)
	}
	wantFull(t, rec.got["/ann2"], charge("2222"))
	wantBare(t, rec.got["/cy"])
	wantNone(t, rec.got["/ann1"])
	wantNone(t, rec.got["/ben"])
}

func TestAChargeWithNoLast4GoesInFullToEverySubscriptionWithAList(t *testing.T) {
	sender, rec, _ := alertFamily(t)
	if _, err := sender.NotifyAlert(allKeys, 5, charge("")); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/ann1", "/ann2", "/ben"} {
		wantFull(t, rec.got[path], charge(""))
	}
	wantBare(t, rec.got["/cy"])
}

func TestAChargeOnACardNoSubscriptionClaimsGoesInFullToEverySubscriptionWithAList(t *testing.T) {
	sender, rec, _ := alertFamily(t)
	if _, err := sender.NotifyAlert(allKeys, 5, charge("9999")); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/ann1", "/ann2", "/ben"} {
		wantFull(t, rec.got[path], charge("9999"))
	}
	wantBare(t, rec.got["/cy"])
}

func TestASubscriptionWithNoListGetsTheBareAlertForEveryCharge(t *testing.T) {
	for _, last4 := range []string{"", "1111", "9999"} {
		sender, rec, _ := alertFamily(t)
		if _, err := sender.NotifyAlert([]string{"cy"}, 5, charge(last4)); err != nil {
			t.Fatal(err)
		}
		wantBare(t, rec.got["/cy"])
	}
}

func TestAnAlertThatIsNotAChargeIsBareForEveryone(t *testing.T) {
	sender, rec, _ := alertFamily(t)
	if _, err := sender.NotifyAlert(allKeys, 5, AlertFacts{ID: "a-2", Merchant: "Amazon"}); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/ann1", "/ann2", "/ben", "/cy"} {
		wantBare(t, rec.got[path])
	}
}

// One phone, two keys (its own and a cockpit's): each key's subscription is
// judged by its own list.
func TestTwoKeysOnOnePhoneAreEachJudgedByTheirOwnList(t *testing.T) {
	sender, rec, store := alertFamily(t)
	phone := newFakePhone(t)
	server := httptest.NewServer(rec.handler())
	t.Cleanup(server.Close)
	// the same endpoint cannot hold two subscriptions (Add replaces), so a phone with two keys has two endpoints
	for key, last4s := range map[string][]string{"two-a": {"2222"}, "two-b": nil} {
		path := "/" + key
		rec.phones[path] = phone
		if err := store.Add(Subscription{PublicKeyHex: key, Endpoint: server.URL + path, Keys: phone.keys(), Last4s: last4s}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := sender.NotifyAlert([]string{"two-a", "two-b"}, 5, charge("2222")); err != nil {
		t.Fatal(err)
	}
	wantFull(t, rec.got["/two-a"], charge("2222")) // names 2222
	wantBare(t, rec.got["/two-b"])                 // sent no list
}

func TestNoLogLineCarriesTheChargesWords(t *testing.T) {
	sender, _, store := alertFamily(t)
	// a dead endpoint (a log line for the failure) and a key in Ideas only (a log line for the withholding)
	if err := store.Add(Subscription{PublicKeyHex: "dead", Endpoint: "http://127.0.0.1:1/x", Keys: newFakePhone(t).keys(), Last4s: []string{"2222"}}); err != nil {
		t.Fatal(err)
	}
	sender.WithIdeasOnly(fakeIdeasOnly{on: map[string]bool{"ben": true}})
	var logged strings.Builder
	log.SetOutput(&logged)
	t.Cleanup(func() { log.SetOutput(io.Discard) })
	_, err := sender.NotifyAlert(append([]string{"dead"}, allKeys...), 5, charge("2222"))
	if err != nil {
		log.Printf("pushing alert: %v", err) // as the api does
	}
	if logged.Len() == 0 {
		t.Fatal("expected a log line to check")
	}
	for _, secret := range []string{"42.17", "Corner Cafe", "2222"} {
		if strings.Contains(logged.String(), secret) {
			t.Fatalf("log carries %q: %s", secret, logged.String())
		}
	}
}

// mw-mr4xgrw.51: every alert push names its kind, so the phone can word a Gmail forwarding
// confirmation as one rather than as a charge to sort. The JSON is what the service worker reads.
func TestEveryAlertPushNamesItsKindInItsJSON(t *testing.T) {
	for _, tc := range []struct {
		name  string
		facts AlertFacts
		keys  []string
		path  string
		want  string
	}{
		{"a charge in full", AlertFacts{ID: "a-1", Kind: "charge", Charge: true, Amount: "42.17", Merchant: "Corner Cafe", Last4: "2222"}, []string{"ann-2"}, "/ann2", `"kind":"charge"`},
		{"a charge, bare, to a phone with no list", AlertFacts{ID: "a-1", Kind: "charge", Charge: true, Amount: "42.17", Merchant: "Corner Cafe", Last4: "2222"}, []string{"cy"}, "/cy", `"kind":"charge"`},
		{"a forwarding confirmation", AlertFacts{ID: "a-3", Kind: "forward-confirm"}, []string{"ann-1"}, "/ann1", `"kind":"forward-confirm"`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			sender, rec, _ := alertFamily(t)
			if sent, err := sender.NotifyAlert(tc.keys, 5, tc.facts); err != nil || sent != 1 {
				t.Fatalf("NotifyAlert = %d, %v, want 1", sent, err)
			}
			if len(rec.got[tc.path]) != 1 {
				t.Fatalf("got %d pushes, want 1", len(rec.got[tc.path]))
			}
			raw, err := json.Marshal(rec.got[tc.path][0])
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(raw), tc.want) {
				t.Fatalf("push JSON %s lacks %s", raw, tc.want)
			}
			if !strings.Contains(string(raw), `"class":"alert"`) {
				t.Fatalf("push JSON %s lacks class alert", raw)
			}
		})
	}
}

// The charge's own fields are as before beside the kind.
func TestTheKindDoesNotChangeTheChargesFields(t *testing.T) {
	sender, rec, _ := alertFamily(t)
	facts := AlertFacts{ID: "a-1", Kind: "charge", Charge: true, Amount: "42.17", Merchant: "Corner Cafe", Last4: "2222"}
	if _, err := sender.NotifyAlert([]string{"ann-2"}, 5, facts); err != nil {
		t.Fatal(err)
	}
	wantFull(t, rec.got["/ann2"], facts)
	if rec.got["/ann2"][0].Kind != "charge" {
		t.Fatalf("kind = %q", rec.got["/ann2"][0].Kind)
	}
}
