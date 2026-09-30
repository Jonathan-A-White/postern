// Package auth guards postern's data endpoints: a caller proves it holds a
// licensed key by signing a short-lived nonce (GET /api/challenge) with that
// key, the same proof the PWA is expected to send (mw-f758y.22.2).
package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	saltBytes = 16
	// A nonce is hex(expiry(8, big-endian unix nanoseconds) || salt(16) ||
	// HMAC-SHA256(key, expiry || salt)(32)): 112 lowercase hex characters, inside
	// the 32..128 the app agrees to sign (src/services/apiAuth.ts).
	nonceRawBytes = 8 + saltBytes + sha256.Size

	// NonceKeyFile is the key's name under POSTERN_DATA.
	NonceKeyFile = "postern-nonce.key"
	nonceKeySize = 32
)

// NonceStore issues short-lived, single-use nonces and consumes them. A
// nonce carries its own expiry and a MAC under a key that both backends
// (the home and the boost) share, so either can verify a nonce the other
// issued (mw-43v9x.19); only the single-use record is per process. Safe for
// concurrent use.
type NonceStore struct {
	ttl time.Duration
	now func() time.Time
	key []byte

	mu   sync.Mutex
	used map[string]time.Time // consumed nonce -> expiry, kept until it would have expired anyway
}

// NonceStoreOption configures a NonceStore constructed by NewNonceStore.
type NonceStoreOption func(*NonceStore)

// WithClock overrides the clock a NonceStore uses to stamp and check
// expiry, so tests can control time without sleeping.
func WithClock(now func() time.Time) NonceStoreOption {
	return func(s *NonceStore) { s.now = now }
}

// WithKey sets the MAC key nonces are made and verified under. Stores that
// share a key verify each other's nonces; without it a store draws a random
// key of its own, and so verifies only its own.
func WithKey(key []byte) NonceStoreOption {
	return func(s *NonceStore) { s.key = append([]byte(nil), key...) }
}

// NewNonceStore builds a NonceStore whose issued nonces expire after ttl.
func NewNonceStore(ttl time.Duration, opts ...NonceStoreOption) *NonceStore {
	s := &NonceStore{
		ttl:  ttl,
		now:  time.Now,
		used: make(map[string]time.Time),
	}
	for _, opt := range opts {
		opt(s)
	}
	if s.key == nil {
		s.key = make([]byte, nonceKeySize)
		if _, err := rand.Read(s.key); err != nil {
			panic(fmt.Sprintf("generating nonce key: %v", err))
		}
	}
	return s
}

// LoadOrCreateNonceKey returns the nonce MAC key in dataDir/postern-nonce.key,
// creating it (32 random bytes, hex, mode 600) the first time this backend
// runs. The boost needs the same key, so the mirror copies the file with the
// rest of the data directory.
func LoadOrCreateNonceKey(dataDir string) ([]byte, error) {
	path := filepath.Join(dataDir, NonceKeyFile)
	key, err := readNonceKey(path)
	if err == nil || !errors.Is(err, fs.ErrNotExist) {
		return key, err
	}

	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("creating data directory %s: %w", dataDir, err)
	}
	key = make([]byte, nonceKeySize)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("generating nonce key: %w", err)
	}
	// Written whole to a temporary file and linked into place, so a second
	// start racing this one never reads half a key and never replaces it.
	tmp, err := os.CreateTemp(dataDir, NonceKeyFile+".tmp*")
	if err != nil {
		return nil, fmt.Errorf("writing %s: %w", path, err)
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return nil, fmt.Errorf("writing %s: %w", path, err)
	}
	if _, err := tmp.WriteString(hex.EncodeToString(key) + "\n"); err != nil {
		tmp.Close()
		return nil, fmt.Errorf("writing %s: %w", path, err)
	}
	if err := tmp.Close(); err != nil {
		return nil, fmt.Errorf("writing %s: %w", path, err)
	}
	if err := os.Link(tmp.Name(), path); err != nil {
		if errors.Is(err, fs.ErrExist) {
			return readNonceKey(path)
		}
		return nil, fmt.Errorf("writing %s: %w", path, err)
	}
	return key, nil
}

func readNonceKey(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}
	key, err := hex.DecodeString(strings.TrimSpace(string(data)))
	if err != nil || len(key) != nonceKeySize {
		return nil, fmt.Errorf("%s is not a %d-byte hex key", path, nonceKeySize)
	}
	return key, nil
}

func (s *NonceStore) mac(body []byte) []byte {
	m := hmac.New(sha256.New, s.key)
	m.Write(body)
	return m.Sum(nil)
}

// Issue generates a new nonce (lowercase hex) that expires ttl from now and
// that any store sharing this store's key can verify.
func (s *NonceStore) Issue() (string, error) {
	raw := make([]byte, 0, nonceRawBytes)
	raw = binary.BigEndian.AppendUint64(raw, uint64(s.now().Add(s.ttl).UnixNano()))
	salt := make([]byte, saltBytes)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generating nonce: %w", err)
	}
	raw = append(raw, salt...)
	raw = append(raw, s.mac(raw)...)
	return hex.EncodeToString(raw), nil
}

// Consume reports whether nonce was issued under this store's key, has not
// expired, and has not been consumed here before, recording it so it can
// never be presented to this store again. A nonce that fails verification is
// not recorded.
func (s *NonceStore) Consume(nonce string) bool {
	raw, err := hex.DecodeString(nonce)
	if err != nil || len(raw) != nonceRawBytes || nonce != strings.ToLower(nonce) {
		return false
	}
	body, mac := raw[:8+saltBytes], raw[8+saltBytes:]
	if !hmac.Equal(mac, s.mac(body)) {
		return false
	}
	now := s.now()
	expiry := time.Unix(0, int64(binary.BigEndian.Uint64(raw[:8])))
	if now.After(expiry) {
		return false
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	for n, exp := range s.used {
		if now.After(exp) {
			delete(s.used, n)
		}
	}
	if _, seen := s.used[nonce]; seen {
		return false
	}
	s.used[nonce] = expiry
	return true
}

// usedCount is how many consumed nonces the store still remembers, for tests.
func (s *NonceStore) usedCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.used)
}
