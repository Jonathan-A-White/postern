// Package blobs stores encrypted message attachments on disk: content-
// addressed by the sha256 of the bytes as received, kept for a fixed
// retention window and swept away after it (docs/protocol.md §8).
package blobs

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

const (
	dirName = "blobs"

	// ownersDirName is the directory beside the blob directory that records
	// who first uploaded each blob: one small file per blob, named by its
	// hash.
	ownersDirName = "blob-owners"

	// MaxBlobBytes is the epic's per-image cap on the encrypted attachment.
	MaxBlobBytes = 8 * 1024 * 1024 // 8 MiB

	// envelopeAllowance covers BRC-78's fixed overhead atop the encrypted
	// bytes, so a body right at the 8 MiB image cap still fits.
	envelopeAllowance = 256

	// MaxBodyBytes is the most a POST /api/blobs body may be before it's
	// refused 413.
	MaxBodyBytes = MaxBlobBytes + envelopeAllowance

	// Retention is how long an uploaded blob is kept before Sweep deletes it.
	Retention = 30 * 24 * time.Hour
)

// ErrNotFound is returned by Open for a hash that is malformed, or that
// names no blob currently on disk (never uploaded, or already swept).
var ErrNotFound = errors.New("blob not found")

var hashPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

// Store is a content-addressed directory of blobs, rooted at
// dataDir/blobs. Safe for concurrent use.
type Store struct {
	dir       string
	ownersDir string
}

// OpenStore creates dataDir/blobs if it doesn't exist yet and returns a
// Store ready for Put, Open, and Sweep.
func OpenStore(dataDir string) (*Store, error) {
	dir := filepath.Join(dataDir, dirName)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("creating blob directory %s: %w", dir, err)
	}
	ownersDir := filepath.Join(dataDir, ownersDirName)
	if err := os.MkdirAll(ownersDir, 0o755); err != nil {
		return nil, fmt.Errorf("creating blob owners directory %s: %w", ownersDir, err)
	}
	return &Store{dir: dir, ownersDir: ownersDir}, nil
}

// SetOwner records key as the uploader of the blob named by hash, unless it
// already has one: the first uploader stays the owner. A malformed hash is
// ErrNotFound.
func (s *Store) SetOwner(hash, key string) error {
	if !hashPattern.MatchString(hash) {
		return ErrNotFound
	}
	file, err := os.OpenFile(filepath.Join(s.ownersDir, hash), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		if os.IsExist(err) {
			return nil
		}
		return fmt.Errorf("recording blob owner: %w", err)
	}
	if _, err := file.WriteString(key); err != nil {
		file.Close()
		return fmt.Errorf("recording blob owner: %w", err)
	}
	return file.Close()
}

// Owner reports who first uploaded the blob named by hash. ok is false for a
// malformed hash and for a blob with no recorded owner (uploaded before
// owners were kept).
func (s *Store) Owner(hash string) (key string, ok bool) {
	if !hashPattern.MatchString(hash) {
		return "", false
	}
	raw, err := os.ReadFile(filepath.Join(s.ownersDir, hash))
	if err != nil || len(raw) == 0 {
		return "", false
	}
	return string(raw), true
}

// Put stores data under the hex sha256 of its bytes, writing to a temp file
// in the same directory and renaming it into place so a reader never sees a
// partial file. A repeat Put of bytes already on disk is a no-op: existed
// reports true and the file (and its mtime) is left untouched.
func (s *Store) Put(data []byte) (hash string, size int, existed bool, err error) {
	sum := sha256.Sum256(data)
	hash = hex.EncodeToString(sum[:])
	finalPath := filepath.Join(s.dir, hash)

	if _, statErr := os.Stat(finalPath); statErr == nil {
		return hash, len(data), true, nil
	} else if !os.IsNotExist(statErr) {
		return "", 0, false, fmt.Errorf("checking existing blob: %w", statErr)
	}

	tmp, err := os.CreateTemp(s.dir, "upload-*.tmp")
	if err != nil {
		return "", 0, false, fmt.Errorf("creating temp file: %w", err)
	}
	tmpPath := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return "", 0, false, fmt.Errorf("writing temp file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return "", 0, false, fmt.Errorf("closing temp file: %w", err)
	}
	if err := os.Rename(tmpPath, finalPath); err != nil {
		os.Remove(tmpPath)
		return "", 0, false, fmt.Errorf("renaming temp file into place: %w", err)
	}
	return hash, len(data), false, nil
}

// Open returns the blob named by hash, and its size, for streaming. hash
// must be 64 lowercase hex characters; anything else, or a hash naming no
// blob currently on disk, is ErrNotFound. The caller must Close the file.
func (s *Store) Open(hash string) (*os.File, int64, error) {
	if !hashPattern.MatchString(hash) {
		return nil, 0, ErrNotFound
	}

	file, err := os.Open(filepath.Join(s.dir, hash))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, 0, ErrNotFound
		}
		return nil, 0, fmt.Errorf("opening blob: %w", err)
	}

	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, 0, fmt.Errorf("statting blob: %w", err)
	}
	return file, info.Size(), nil
}

// Delete removes the blob named by hash at once, rather than leaving it for
// Sweep (docs/protocol.md §19: the mill deletes a grist's photos once it has
// answered). A malformed hash, or one naming no blob on disk, is ErrNotFound.
func (s *Store) Delete(hash string) error {
	if !hashPattern.MatchString(hash) {
		return ErrNotFound
	}
	if err := os.Remove(filepath.Join(s.dir, hash)); err != nil {
		if os.IsNotExist(err) {
			return ErrNotFound
		}
		return fmt.Errorf("deleting blob: %w", err)
	}
	os.Remove(filepath.Join(s.ownersDir, hash))
	return nil
}

// Sweep deletes every blob whose mtime is older than Retention relative to
// now.
func (s *Store) Sweep(now time.Time) error {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return fmt.Errorf("reading blob directory: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue // gone by the time we stat it; nothing to sweep
		}
		if now.Sub(info.ModTime()) > Retention {
			os.Remove(filepath.Join(s.dir, entry.Name()))
			os.Remove(filepath.Join(s.ownersDir, entry.Name()))
		}
	}
	return nil
}
