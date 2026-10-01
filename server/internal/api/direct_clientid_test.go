package api

import (
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

// envelopeAt is envelope() with its own ts, so two posts differ in their bytes
// the way two encryptions of one message do.
func envelopeAt(from string, ts int) []byte {
	return []byte(strings.Replace(string(envelope(from)), `"ts":1758700000`, fmt.Sprintf(`"ts":%d`, ts), 1))
}

func directBody(from string, ts int, clientID string) string {
	body := `{"scriptHex":"` + hex.EncodeToString(recordScript(1, envelopeAt(from, ts))) + `"`
	if clientID != "" {
		body += `,"clientId":"` + clientID + `"`
	}
	return body + `}`
}

func TestDirectMessageRetriedWithTheSameClientIDIsStoredOnce(t *testing.T) {
	notifier := &recordingNotifier{}
	server, store := newServerWithOptions(t, WithNotifier(notifier))
	key, pubKeyHex := newKey(t)

	first := decodeDirect(t, postDirect(t, server, key, directBody(pubKeyHex, 1758700001, "a1b2c3d4e5f60718293a4b5c6d7e8f90")))
	// The reply was lost; the phone sends it again, encrypted afresh: other bytes, same client id.
	resp := postDirect(t, server, key, directBody(pubKeyHex, 1758700002, "a1b2c3d4e5f60718293a4b5c6d7e8f90"))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("retry status = %d, want 200", resp.StatusCode)
	}
	again := decodeDirect(t, resp)
	if again.TxID != first.TxID || again.Seq != first.Seq {
		t.Fatalf("retry = %+v, want the first acceptance %+v", again, first)
	}
	if records, _ := store.Since(0); len(records) != 1 {
		t.Fatalf("stored %d records, want 1", len(records))
	}
	if n := len(notifier.records()); n != 1 {
		t.Fatalf("notified %d times, want once", n)
	}
}

func TestDirectMessagesWithDifferentClientIDsAreStoredTwice(t *testing.T) {
	server, store := newServerWithOptions(t)
	key, pubKeyHex := newKey(t)

	a := decodeDirect(t, postDirect(t, server, key, directBody(pubKeyHex, 1758700001, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")))
	b := decodeDirect(t, postDirect(t, server, key, directBody(pubKeyHex, 1758700001, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")))
	// Identical bytes under different ids are still one record by the script's own name (§9).
	if a.TxID != b.TxID {
		t.Fatalf("identical scripts named %s and %s, want one name", a.TxID, b.TxID)
	}
	c := decodeDirect(t, postDirect(t, server, key, directBody(pubKeyHex, 1758700003, "cccccccccccccccccccccccccccccccc")))
	d := decodeDirect(t, postDirect(t, server, key, directBody(pubKeyHex, 1758700004, "dddddddddddddddddddddddddddddddd")))
	if c.TxID == d.TxID {
		t.Fatalf("two rows named one record %s", c.TxID)
	}
	if records, _ := store.Since(0); len(records) != 3 {
		t.Fatalf("stored %d records, want 3", len(records))
	}
}

func TestDirectMessageClientIDIsPerKey(t *testing.T) {
	server, store := newServerWithOptions(t)
	keyA, pubA := newKey(t)
	keyB, pubB := newKey(t)

	a := decodeDirect(t, postDirect(t, server, keyA, directBody(pubA, 1758700001, "a1b2c3d4e5f60718293a4b5c6d7e8f90")))
	b := decodeDirect(t, postDirect(t, server, keyB, directBody(pubB, 1758700002, "a1b2c3d4e5f60718293a4b5c6d7e8f90")))
	if a.TxID == b.TxID {
		t.Fatalf("two keys sharing an id got one record %s", a.TxID)
	}
	if records, _ := store.Since(0); len(records) != 2 {
		t.Fatalf("stored %d records, want 2", len(records))
	}
}

func TestDirectMessageWithoutAClientIDIsAsBefore(t *testing.T) {
	server, store := newServerWithOptions(t)
	key, pubKeyHex := newKey(t)
	decodeDirect(t, postDirect(t, server, key, directBody(pubKeyHex, 1758700001, "")))
	decodeDirect(t, postDirect(t, server, key, directBody(pubKeyHex, 1758700002, "")))
	if records, _ := store.Since(0); len(records) != 2 {
		t.Fatalf("stored %d records, want 2 (no id, no dedupe)", len(records))
	}
}

func TestDirectMessageRefusesAMalformedClientID(t *testing.T) {
	server, store := newServerWithOptions(t)
	key, pubKeyHex := newKey(t)
	for name, id := range map[string]string{"spaces": "not an id", "too long": strings.Repeat("a", 129), "punctuation": "a;b"} {
		resp := postDirect(t, server, key, directBody(pubKeyHex, 1758700001, id))
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("%s: status = %d, want 400", name, resp.StatusCode)
		}
		resp.Body.Close()
	}
	if records, _ := store.Since(0); len(records) != 0 {
		t.Fatalf("stored %d records, want none", len(records))
	}
}

func TestClientIDsForgetAfterTheirWindowAndStayBounded(t *testing.T) {
	now := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	seen := newClientIDs(func() time.Time { return now })
	seen.remember("k", "id1", "direct:one", 1)
	if got, ok := seen.lookup("k", "id1"); !ok || got.txid != "direct:one" {
		t.Fatalf("lookup = %+v %v, want the remembered record", got, ok)
	}
	now = now.Add(clientIDWindow + time.Second)
	if _, ok := seen.lookup("k", "id1"); ok {
		t.Fatalf("an id older than the window is still remembered")
	}
	for i := 0; i < clientIDLimit+10; i++ {
		seen.remember("k", fmt.Sprintf("id%d", i), "direct:x", uint64(i))
	}
	if n := seen.size(); n > clientIDLimit {
		t.Fatalf("remembers %d ids, want at most %d", n, clientIDLimit)
	}
}
