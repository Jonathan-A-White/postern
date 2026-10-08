package auth

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"testing"
	"time"
)

func TestNonceStoreIssueThenConsumeSucceedsOnce(t *testing.T) {
	store := NewNonceStore(time.Minute)

	nonce, err := store.Issue()
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if nonce == "" {
		t.Fatal("Issue returned an empty nonce")
	}

	if !store.Consume(nonce) {
		t.Fatal("Consume returned false for a freshly issued nonce")
	}
	if store.Consume(nonce) {
		t.Fatal("Consume returned true a second time for the same nonce (replay)")
	}
}

func TestNonceStoreIssueReturnsDistinctNonces(t *testing.T) {
	store := NewNonceStore(time.Minute)

	first, err := store.Issue()
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	second, err := store.Issue()
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if first == second {
		t.Fatal("Issue returned the same nonce twice")
	}
}

func TestNonceStoreConsumeRejectsUnknownNonce(t *testing.T) {
	store := NewNonceStore(time.Minute)

	if store.Consume("never-issued") {
		t.Fatal("Consume returned true for a nonce that was never issued")
	}
}

func TestNonceStoreConsumeRejectsExpiredNonce(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	store := NewNonceStore(time.Minute, WithClock(func() time.Time { return now }))

	nonce, err := store.Issue()
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}

	now = now.Add(2 * time.Minute)
	if store.Consume(nonce) {
		t.Fatal("Consume returned true for a nonce past its TTL")
	}
}

func TestNonceIsPlainLowercaseHexTheAppWillSign(t *testing.T) {
	store := NewNonceStore(time.Minute)
	nonce, err := store.Issue()
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	// The app signs only /^[0-9a-f]{32,128}$/ (src/services/apiAuth.ts).
	if len(nonce) < 32 || len(nonce) > 128 {
		t.Fatalf("nonce length = %d, want 32..128", len(nonce))
	}
	for _, c := range nonce {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			t.Fatalf("nonce %q has a character outside lowercase hex", nonce)
		}
	}
}

func TestNonceSharingAKeyIsVerifiedByEitherStore(t *testing.T) {
	key := bytes.Repeat([]byte{7}, 32)
	a := NewNonceStore(time.Minute, WithKey(key))
	b := NewNonceStore(time.Minute, WithKey(key))

	nonce, err := a.Issue()
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if !b.Consume(nonce) {
		t.Fatal("B refused a nonce A issued under the same key")
	}
	if b.Consume(nonce) {
		t.Fatal("B accepted the nonce a second time")
	}
}

func TestNonceUnderAnotherKeyIsRefused(t *testing.T) {
	a := NewNonceStore(time.Minute, WithKey(bytes.Repeat([]byte{1}, 32)))
	b := NewNonceStore(time.Minute, WithKey(bytes.Repeat([]byte{2}, 32)))

	nonce, _ := a.Issue()
	if b.Consume(nonce) {
		t.Fatal("a store accepted a nonce made under a different key")
	}
}

func TestTamperedNonceIsRefused(t *testing.T) {
	key := bytes.Repeat([]byte{7}, 32)
	a := NewNonceStore(time.Minute, WithKey(key))
	b := NewNonceStore(time.Minute, WithKey(key))

	nonce, _ := a.Issue()
	// Flip the last hex digit (inside the MAC), and one in the expiry.
	for _, i := range []int{len(nonce) - 1, 0} {
		raw := []byte(nonce)
		if raw[i] == '0' {
			raw[i] = '1'
		} else {
			raw[i] = '0'
		}
		if b.Consume(string(raw)) {
			t.Fatalf("accepted a nonce tampered at index %d", i)
		}
	}
	if !b.Consume(nonce) {
		t.Fatal("the untampered nonce was refused after the tampered ones")
	}
}

func TestSharedKeyExpiredNonceIsRefusedByBoth(t *testing.T) {
	key := bytes.Repeat([]byte{7}, 32)
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	clock := WithClock(func() time.Time { return now })
	a := NewNonceStore(time.Minute, WithKey(key), clock)
	b := NewNonceStore(time.Minute, WithKey(key), clock)

	nonce, _ := a.Issue()
	now = now.Add(2 * time.Minute)
	if a.Consume(nonce) || b.Consume(nonce) {
		t.Fatal("an expired nonce was accepted")
	}
}

func TestLoadOrCreateNonceKeyCreatesA600FileThenReusesIt(t *testing.T) {
	dir := t.TempDir()

	first, err := LoadOrCreateNonceKey(dir)
	if err != nil {
		t.Fatalf("LoadOrCreateNonceKey: %v", err)
	}
	if len(first) != 32 {
		t.Fatalf("key length = %d, want 32", len(first))
	}
	info, err := os.Stat(filepath.Join(dir, NonceKeyFile))
	if err != nil {
		t.Fatalf("key file not created: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("key file mode = %o, want 600", info.Mode().Perm())
	}

	second, err := LoadOrCreateNonceKey(dir)
	if err != nil {
		t.Fatalf("LoadOrCreateNonceKey (restart): %v", err)
	}
	if !bytes.Equal(first, second) {
		t.Fatal("a restart made a different key")
	}
}

func TestLoadOrCreateNonceKeyRefusesAMalformedFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, NonceKeyFile), []byte("short"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadOrCreateNonceKey(dir); err == nil {
		t.Fatal("a malformed key file was accepted")
	}
}

func TestLoadOrCreateNonceKeyCreatesTheDataDirectory(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "not", "yet")
	if _, err := LoadOrCreateNonceKey(dir); err != nil {
		t.Fatalf("LoadOrCreateNonceKey: %v", err)
	}
}

func TestConsumedNonceSetForgetsExpiredEntries(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	store := NewNonceStore(time.Minute, WithClock(func() time.Time { return now }))
	for i := 0; i < 5; i++ {
		nonce, _ := store.Issue()
		store.Consume(nonce)
	}
	now = now.Add(time.Hour)
	nonce, _ := store.Issue()
	store.Consume(nonce)
	if n := store.usedCount(); n != 1 {
		t.Fatalf("used set holds %d entries after expiry, want 1", n)
	}
}

// A nonce is expiry(8) || salt(16) || hostid(8) || MAC(32): exactly 128 hex,
// the top of what the app agrees to sign (mw-xhtcup.6).
func TestNonceIsExactly128LowercaseHex(t *testing.T) {
	store := NewNonceStore(time.Minute)
	for i := 0; i < 20; i++ {
		nonce, err := store.Issue()
		if err != nil {
			t.Fatalf("Issue: %v", err)
		}
		if !regexp.MustCompile(`^[0-9a-f]{32,128}$`).MatchString(nonce) {
			t.Fatalf("nonce %q does not match the app's ^[0-9a-f]{32,128}$", nonce)
		}
		if len(nonce) != 128 {
			t.Fatalf("nonce length = %d, want exactly 128", len(nonce))
		}
	}
}

func TestNonceCarriesTheFirst8BytesOfSha256OfTheHostname(t *testing.T) {
	store := NewNonceStore(time.Minute, WithHostname("laptop"))
	nonce, _ := store.Issue()
	sum := sha256.Sum256([]byte("laptop"))
	// expiry(8) || salt(16) puts the host id at hex offset 48..64.
	if got, want := nonce[48:64], hex.EncodeToString(sum[:8]); got != want {
		t.Fatalf("host id in nonce = %s, want %s", got, want)
	}
}

func TestNonceIssuedByAnotherHostIsRefusedAndTheIssuerAcceptsIt(t *testing.T) {
	key := bytes.Repeat([]byte{7}, 32)
	a := NewNonceStore(time.Minute, WithKey(key), WithHostname("laptop"))
	b := NewNonceStore(time.Minute, WithKey(key), WithHostname("desktop"))

	nonce, _ := a.Issue()
	if err := b.Spend(nonce); !errors.Is(err, ErrNonceHost) {
		t.Fatalf("B on A's nonce: err = %v, want ErrNonceHost", err)
	}
	if b.Consume(nonce) {
		t.Fatal("B consumed a nonce another host issued")
	}
	if err := a.Spend(nonce); err != nil {
		t.Fatalf("A on its own nonce: %v (a refusal elsewhere must not burn it)", err)
	}
}

func TestNonceIssuedBeforeThisProcessStartedIsRefused(t *testing.T) {
	key := bytes.Repeat([]byte{7}, 32)
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	clock := WithClock(func() time.Time { return now })

	before := NewNonceStore(2*time.Minute, WithKey(key), WithHostname("laptop"), clock)
	old, _ := before.Issue()

	now = now.Add(30 * time.Second)
	restarted := NewNonceStore(2*time.Minute, WithKey(key), WithHostname("laptop"), clock)
	if err := restarted.Spend(old); !errors.Is(err, ErrNonceStale) {
		t.Fatalf("restarted store on a pre-restart nonce: err = %v, want ErrNonceStale", err)
	}
	if restarted.Consume(old) {
		t.Fatal("a nonce issued before the process started was consumed")
	}

	now = now.Add(time.Second)
	fresh, _ := restarted.Issue()
	if err := restarted.Spend(fresh); err != nil {
		t.Fatalf("a nonce issued after the start: %v", err)
	}
}

func TestReplayOnTheSameStoreIsStillRefused(t *testing.T) {
	store := NewNonceStore(time.Minute, WithHostname("laptop"))
	nonce, _ := store.Issue()
	if err := store.Spend(nonce); err != nil {
		t.Fatalf("first Spend: %v", err)
	}
	if err := store.Spend(nonce); !errors.Is(err, ErrNonceInvalid) {
		t.Fatalf("replay: err = %v, want ErrNonceInvalid", err)
	}
}

func TestNonceOfTheOldSeventeenByteShapeIsRefused(t *testing.T) {
	// A 112-hex v1 nonce (no host id) made under the same key must not verify.
	key := bytes.Repeat([]byte{7}, 32)
	store := NewNonceStore(time.Minute, WithKey(key))
	raw := make([]byte, 24)
	binary.BigEndian.PutUint64(raw, uint64(time.Now().Add(time.Minute).UnixNano()))
	m := hmac.New(sha256.New, key)
	m.Write(raw)
	v1 := hex.EncodeToString(append(raw, m.Sum(nil)...))
	if err := store.Spend(v1); !errors.Is(err, ErrNonceInvalid) {
		t.Fatalf("v1 nonce: err = %v, want ErrNonceInvalid", err)
	}
}
