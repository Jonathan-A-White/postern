// Package view serves the live, encrypted view of the factory
// (docs/protocol.md §11): the file mw writes atomically to
// POSTERN_VIEW_FILE, read as it stands on disk, named by the sha256 of its
// bytes, and watched for changes so the event stream can say when to
// revalidate.
package view

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"time"
)

// DefaultWatchInterval is how often Watch checks the file's size, mtime and
// identity.
const DefaultWatchInterval = time.Second

// ErrNoView is Read's answer when no view file is configured or none has
// been written yet.
var ErrNoView = errors.New("no view written yet")

// File is the view file at one path. The zero path means no view is
// configured. Safe for concurrent use: every call reads the disk afresh.
type File struct {
	path string
}

// New returns the view file at path ("" for none configured).
func New(path string) *File {
	return &File{path: path}
}

// Read returns the view file's bytes and its ETag — the sha256 of the bytes
// as lowercase hex, in double quotes, exactly as the ETag header carries it —
// or ErrNoView if no path is configured or the file does not exist.
func (f *File) Read() ([]byte, string, error) {
	if f == nil || f.path == "" {
		return nil, "", ErrNoView
	}
	data, err := os.ReadFile(f.path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, "", ErrNoView
		}
		return nil, "", fmt.Errorf("reading view file: %w", err)
	}
	return data, ETagOf(data), nil
}

// ETag returns the current view's ETag, or "" when there is no view (or it
// cannot be read).
func (f *File) ETag() string {
	_, etag, err := f.Read()
	if err != nil {
		return ""
	}
	return etag
}

// ETagOf is the ETag of a view whose bytes are data.
func ETagOf(data []byte) string {
	sum := sha256.Sum256(data)
	return `"` + hex.EncodeToString(sum[:]) + `"`
}

// Watch checks the file every interval until stop is closed. Whenever its
// size, mtime or identity (an atomic rename makes a new file) has moved, it
// re-reads the bytes, and if their ETag differs from the last one seen it
// calls onChange with the new ETag — "" once the file is gone. The view as
// it stands when Watch starts is the baseline, not a change. A file that
// cannot be read is left for the next check.
func (f *File) Watch(stop <-chan struct{}, interval time.Duration, onChange func(etag string)) {
	if f == nil || f.path == "" {
		return
	}

	lastInfo, _ := os.Stat(f.path)
	lastETag := f.ETag()

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
		}

		info, err := os.Stat(f.path)
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if sameFile(lastInfo, info) {
			continue
		}

		etag := ""
		if info != nil {
			_, read, err := f.Read()
			if err != nil && !errors.Is(err, ErrNoView) {
				continue
			}
			etag = read
		}
		lastInfo = info
		if etag != lastETag {
			lastETag = etag
			onChange(etag)
		}
	}
}

// sameFile reports whether a and b (either nil for "no file") look like the
// same unchanged file: both absent, or the same file with the same size and
// mtime.
func sameFile(a, b os.FileInfo) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return os.SameFile(a, b) && a.Size() == b.Size() && a.ModTime().Equal(b.ModTime())
}
