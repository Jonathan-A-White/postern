package api

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/poller"
)

// mw-gq6.965: the poller failed for six days and nothing the Laptop reads said
// so. /healthz now carries the poller's last good poll and its last error;
// `ok` stays true, because the watchdog restarts a backend whose /healthz
// is not.
func TestHealthzSaysTheLastGoodPollAndTheLastError(t *testing.T) {
	failingSince := time.Date(2026, 11, 4, 16, 0, 0, 0, time.UTC)
	status := poller.Status{
		OK: false, LastError: "fetching anchor history: WhatsOnChain said 503",
		LastErrorAt: failingSince.Add(11 * time.Minute), FailingSince: failingSince, Alarm: true,
		LastGoodPoll: failingSince.Add(-5 * time.Second),
	}
	server, _ := newServerWithOptions(t, WithPollStatus(func() poller.Status { return status }))

	resp, err := http.Get(server.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz: %v", err)
	}
	defer resp.Body.Close()
	var got struct {
		OK   bool `json:"ok"`
		Poll *struct {
			OK           bool      `json:"ok"`
			LastGoodPoll time.Time `json:"lastGoodPoll"`
			LastError    string    `json:"lastError"`
			LastErrorAt  time.Time `json:"lastErrorAt"`
			FailingSince time.Time `json:"failingSince"`
			Alarm        bool      `json:"alarm"`
		} `json:"poll"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decoding: %v", err)
	}
	if !got.OK {
		t.Errorf("ok = false, want true (a failing poll must not make the watchdog restart the backend)")
	}
	if got.Poll == nil || got.Poll.OK || !got.Poll.Alarm || got.Poll.LastError != status.LastError ||
		!got.Poll.LastGoodPoll.Equal(status.LastGoodPoll) || !got.Poll.FailingSince.Equal(failingSince) {
		t.Fatalf("poll = %+v, want the status the poller gave", got.Poll)
	}
}

func TestHealthzWithoutAPollerSaysNothingOfPolling(t *testing.T) {
	server, _ := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {})
	resp, err := http.Get(server.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz: %v", err)
	}
	defer resp.Body.Close()
	var got map[string]json.RawMessage
	json.NewDecoder(resp.Body).Decode(&got)
	if _, ok := got["poll"]; ok {
		t.Fatalf("healthz = %v, want no poll field without a poller", got)
	}
}
