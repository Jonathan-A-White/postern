package blobs

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPutThenGetRoundTrips(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}

	data := make([]byte, 1<<20)
	if _, err := rand.Read(data); err != nil {
		t.Fatalf("rand.Read: %v", err)
	}

	hash, size, existed, err := store.Put(data)
	if err != nil {
		t.Fatalf("Put: %v", err)
	}
	if existed {
		t.Fatal("existed = true on a first upload")
	}
	if size != len(data) {
		t.Fatalf("size = %d, want %d", size, len(data))
	}
	wantSum := sha256.Sum256(data)
	if hash != hex.EncodeToString(wantSum[:]) {
		t.Fatalf("hash = %q, want the body's own sha256 %x", hash, wantSum)
	}

	file, gotSize, err := store.Open(hash)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer file.Close()
	if gotSize != int64(len(data)) {
		t.Fatalf("Open size = %d, want %d", gotSize, len(data))
	}
	got, err := io.ReadAll(file)
	if err != nil {
		t.Fatalf("reading blob: %v", err)
	}
	if !bytes.Equal(got, data) {
		t.Fatal("round-tripped bytes don't match what was Put")
	}
}

func TestPutIsANoOpOnRepeatUpload(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenStore(dir)
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}

	data := []byte("hello world, this is a repeated blob")

	hash1, _, existed1, err := store.Put(data)
	if err != nil {
		t.Fatalf("Put (first): %v", err)
	}
	if existed1 {
		t.Fatal("existed = true on a first upload")
	}

	hash2, size2, existed2, err := store.Put(data)
	if err != nil {
		t.Fatalf("Put (repeat): %v", err)
	}
	if hash2 != hash1 {
		t.Fatalf("repeat Put hash = %q, want %q", hash2, hash1)
	}
	if !existed2 {
		t.Fatal("existed = false on a repeat upload of the same bytes")
	}
	if size2 != len(data) {
		t.Fatalf("repeat Put size = %d, want %d", size2, len(data))
	}

	entries, err := os.ReadDir(filepath.Join(dir, "blobs"))
	if err != nil {
		t.Fatalf("reading blob directory: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("blob directory has %d entries, want exactly 1 (no second file written)", len(entries))
	}
}

func TestGetRefusesUnknownHash(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}

	_, _, err = store.Open(strings.Repeat("a", 64))
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("Open(unknown hash) err = %v, want ErrNotFound", err)
	}
}

func TestGetRefusesMalformedHash(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}

	for _, bad := range []string{
		"",
		"not-hex-at-all",
		strings.Repeat("A", 64), // uppercase
		strings.Repeat("a", 63), // too short
		strings.Repeat("a", 65), // too long
		"../../../../etc/passwd",
	} {
		if _, _, err := store.Open(bad); !errors.Is(err, ErrNotFound) {
			t.Errorf("Open(%q) err = %v, want ErrNotFound", bad, err)
		}
	}
}

func TestSweepRemovesOnlyBlobsOlderThanRetention(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenStore(dir)
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}

	oldHash, _, _, err := store.Put([]byte("thirty-one days old"))
	if err != nil {
		t.Fatalf("Put (old): %v", err)
	}
	newHash, _, _, err := store.Put([]byte("twenty-nine days old"))
	if err != nil {
		t.Fatalf("Put (new): %v", err)
	}

	now := time.Date(2026, 9, 26, 0, 0, 0, 0, time.UTC)
	oldPath := filepath.Join(dir, "blobs", oldHash)
	newPath := filepath.Join(dir, "blobs", newHash)
	oldTime := now.Add(-31 * 24 * time.Hour)
	newTime := now.Add(-29 * 24 * time.Hour)
	if err := os.Chtimes(oldPath, oldTime, oldTime); err != nil {
		t.Fatalf("Chtimes (old): %v", err)
	}
	if err := os.Chtimes(newPath, newTime, newTime); err != nil {
		t.Fatalf("Chtimes (new): %v", err)
	}

	if err := store.Sweep(now); err != nil {
		t.Fatalf("Sweep: %v", err)
	}

	if _, err := os.Stat(oldPath); !os.IsNotExist(err) {
		t.Fatal("a 31-day-old blob should have been removed by Sweep")
	}
	if _, err := os.Stat(newPath); err != nil {
		t.Fatalf("a 29-day-old blob should still exist, stat: %v", err)
	}
}

func TestDeleteRemovesABlob(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	hash, _, _, err := store.Put([]byte("sealed photo"))
	if err != nil {
		t.Fatalf("Put: %v", err)
	}

	if err := store.Delete(hash); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, _, err := store.Open(hash); err != ErrNotFound {
		t.Fatalf("Open after Delete: err = %v, want ErrNotFound", err)
	}
}

func TestDeleteRefusesAnUnknownOrMalformedHash(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	for _, hash := range []string{strings.Repeat("a", 64), "../postern-index.jsonl", ""} {
		if err := store.Delete(hash); err != ErrNotFound {
			t.Fatalf("Delete(%q): err = %v, want ErrNotFound", hash, err)
		}
	}
}
