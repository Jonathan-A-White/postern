package view

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func etagOf(data string) string {
	sum := sha256.Sum256([]byte(data))
	return `"` + hex.EncodeToString(sum[:]) + `"`
}

// writeAtomically writes data the way mw does: a temp file renamed over the
// view path.
func writeAtomically(t *testing.T, path, data string) {
	t.Helper()
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(data), 0o644); err != nil {
		t.Fatalf("writing %s: %v", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		t.Fatalf("renaming into %s: %v", path, err)
	}
}

func TestReadAnswersNoViewWhenUnsetOrNotWritten(t *testing.T) {
	if _, _, err := New("").Read(); !errors.Is(err, ErrNoView) {
		t.Fatalf("Read with no path = %v, want ErrNoView", err)
	}
	if _, _, err := New(filepath.Join(t.TempDir(), "view.txt")).Read(); !errors.Is(err, ErrNoView) {
		t.Fatalf("Read of a missing file = %v, want ErrNoView", err)
	}
	if etag := New("").ETag(); etag != "" {
		t.Fatalf("ETag with no path = %q, want empty", etag)
	}
}

func TestReadAnswersTheBytesAndTheirETag(t *testing.T) {
	path := filepath.Join(t.TempDir(), "view.txt")
	writeAtomically(t, path, "QkIQMwOd...")

	data, etag, err := New(path).Read()
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if string(data) != "QkIQMwOd..." {
		t.Fatalf("data = %q", data)
	}
	if etag != etagOf("QkIQMwOd...") {
		t.Fatalf("etag = %s, want %s", etag, etagOf("QkIQMwOd..."))
	}
	if got := New(path).ETag(); got != etag {
		t.Fatalf("ETag() = %s, want %s", got, etag)
	}
}

func TestWatchReportsEachNewETagOnce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "view.txt")
	writeAtomically(t, path, "first")

	changes := make(chan string, 10)
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		New(path).Watch(stop, 5*time.Millisecond, func(etag string) { changes <- etag })
		close(done)
	}()
	defer func() {
		close(stop)
		<-done
	}()

	expectNone := func(why string) {
		t.Helper()
		select {
		case etag := <-changes:
			t.Fatalf("%s: got a change to %s, want none", why, etag)
		case <-time.After(60 * time.Millisecond):
		}
	}
	expect := func(want string) {
		t.Helper()
		select {
		case etag := <-changes:
			if etag != want {
				t.Fatalf("change to %s, want %s", etag, want)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("no change reported, want %s", want)
		}
	}

	expectNone("the view as it stood when watching began")

	writeAtomically(t, path, "second, longer")
	expect(etagOf("second, longer"))

	// Same length, new bytes, so only the mtime or inode tells.
	writeAtomically(t, path, "second, LONGER")
	expect(etagOf("second, LONGER"))

	// Rewritten with identical bytes: nothing changed for a reader.
	writeAtomically(t, path, "second, LONGER")
	expectNone("identical bytes rewritten")

	if err := os.Remove(path); err != nil {
		t.Fatalf("removing view: %v", err)
	}
	expect("")

	writeAtomically(t, path, "third")
	expect(etagOf("third"))
}
