package api

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

// The events record (docs/protocol.md §22): a batch of factory events the
// Mayor's key posts direct to the Governor. It is indexed and published as one
// message event like any direct record.
func TestAnEventsRecordFromTheMayorsKeyIsIndexedAndPublishedOnce(t *testing.T) {
	// The Mayor's key holds the cockpit licence the vectors give the governor.
	s := newGristServerHolding(t, map[string][]string{"stranger": {"postern"}}, WithIdentity(vectorKeyHex(t, "stranger"), "testnet"))
	governor, _ := s.v.key(t, "governor")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	resp, frames := openStream(t, ctx, s.URL, v2As(t, s.Server, governor, "GET", "/api/events", nil))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/events as the Governor: status %d, want 200", resp.StatusCode)
	}
	if hello := nextEvent(t, frames); hello.name != "hello" {
		t.Fatalf("first event = %q, want hello", hello.name)
	}

	sent := s.deliver(t, "events", "stranger", "governor")
	got := decodeDirect(t, sent)
	if sent.StatusCode != http.StatusCreated {
		t.Fatalf("delivering an events record: status %d (%s), want 201", sent.StatusCode, got.Error)
	}

	event := nextEvent(t, frames)
	if event.name != "message" {
		t.Fatalf("event after the events record = %q, want message", event.name)
	}
	var data struct {
		Seq uint64 `json:"seq"`
	}
	if err := json.Unmarshal([]byte(event.data), &data); err != nil || data.Seq != got.Seq {
		t.Fatalf("message event data = %q, want seq %d", event.data, got.Seq)
	}

	records, _ := s.store.Since(0)
	if len(records) != 1 || records[0].TxID != got.TxID {
		t.Fatalf("index holds %d records after one events record (%+v), want exactly %s", len(records), records, got.TxID)
	}

	// Posting the same bytes again is a retry: 200, no second row, no second event.
	again := s.deliver(t, "events", "stranger", "governor")
	if again.StatusCode != http.StatusOK {
		t.Fatalf("redelivering the events record: status %d, want 200", again.StatusCode)
	}
	if records, _ := s.store.Since(0); len(records) != 1 {
		t.Fatalf("index holds %d records after a retry, want 1", len(records))
	}
}
