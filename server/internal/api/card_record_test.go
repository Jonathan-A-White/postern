package api

import (
	"net/http"
	"testing"
)

// The card and card-update records (docs/protocol.md §24): the Mayor's key posts them direct
// to the Governor, who is sent them by sync like any message.
func TestACardAndACardUpdateAreStoredAndServedBySyncToAnotherLicensedKey(t *testing.T) {
	// The Mayor's key holds the cockpit licence the vectors give the governor.
	s := newGristServerHolding(t, map[string][]string{"stranger": {"postern"}}, WithIdentity(vectorKeyHex(t, "stranger"), "testnet"))

	var ids []string
	for _, class := range []string{"card", "card-update"} {
		sent := s.deliver(t, class, "stranger", "governor")
		got := decodeDirect(t, sent)
		if sent.StatusCode != http.StatusCreated {
			t.Fatalf("delivering a %s record: status %d (%s), want 201", class, sent.StatusCode, got.Error)
		}
		ids = append(ids, got.TxID)
	}

	if records, _ := s.store.Since(0); len(records) != 2 {
		t.Fatalf("index holds %d records after a card and its update, want 2", len(records))
	}
	records, next := s.messagesFor(t, "governor")
	if len(records) != 2 || next != 2 {
		t.Fatalf("sync gave the Governor %d records (next %d), want 2", len(records), next)
	}
	for i, id := range ids {
		if records[i].TxID != id {
			t.Fatalf("sync record %d = %s, want %s, in order sent", i, records[i].TxID, id)
		}
	}
}
