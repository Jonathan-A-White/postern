package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/events"
	"github.com/Jonathan-A-White/postern/server/internal/ideasonly"
)

// Ideas only (docs/protocol.md §25): a setting per key, read by the key, any
// cockpit key and the Mayor's key, written only by the key itself.

// manualClock is the ideasonly store's clock, moved by the test: its timers
// fire when Advance passes them.
type manualClock struct {
	mu     sync.Mutex
	now    time.Time
	timers []*manualTimer
}

type manualTimer struct {
	at      time.Time
	f       func()
	stopped bool
}

func (c *manualClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *manualClock) AfterFunc(d time.Duration, f func()) func() {
	c.mu.Lock()
	defer c.mu.Unlock()
	tm := &manualTimer{at: c.now.Add(d), f: f}
	c.timers = append(c.timers, tm)
	return func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		tm.stopped = true
	}
}

func (c *manualClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	var due []*manualTimer
	for _, tm := range c.timers {
		if !tm.stopped && !tm.at.After(c.now) {
			tm.stopped = true
			due = append(due, tm)
		}
	}
	c.mu.Unlock()
	for _, tm := range due {
		tm.f()
	}
}

type ideasBody struct {
	Setting ideasonly.Setting `json:"setting"`
	State   ideasonly.Status  `json:"state"`
	Error   string            `json:"error"`
}

// newIdeasServer is a grist server whose Mayor is the vectors' stranger (no
// licence); cairnPhone is given the cockpit collection too, so there are two
// cockpit keys.
func newIdeasServer(t *testing.T, clock *manualClock, hub *events.Hub) gristServer {
	t.Helper()
	store, err := ideasonly.OpenStore(t.TempDir(),
		ideasonly.WithClock(clock.Now, clock.AfterFunc),
		ideasonly.WithPublish(func(key string, st ideasonly.Status) { hub.IdeasOnlyChanged(key, st.On, st.Until) }))
	if err != nil {
		t.Fatalf("ideasonly.OpenStore: %v", err)
	}
	t.Cleanup(store.Stop)
	return newGristServerHolding(t, map[string][]string{"cairnPhone": {"postern"}},
		WithIdentity(vectorKeyHex(t, "stranger"), "testnet"),
		WithEvents(hub, time.Hour),
		WithIdeasOnly(store))
}

func (s gristServer) ideas(t *testing.T, as, method, key, body string) (int, ideasBody) {
	t.Helper()
	resp := s.do(t, as, method, "/api/ideas-only/"+key, body)
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var out ideasBody
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatalf("decoding %q: %v", raw, err)
		}
	}
	return resp.StatusCode, out
}

func TestTheKeyItselfPutsItsSettingAndGetsTheStateBack(t *testing.T) {
	clock := &manualClock{now: time.Unix(1_800_000_000, 0)}
	s := newIdeasServer(t, clock, events.NewHub())
	governor := vectorKeyHex(t, "governor")
	until := clock.now.Unix() + 3600

	status, put := s.ideas(t, "governor", http.MethodPut, governor, `{"until":`+itoa(until)+`,"reaches":{"ring":true,"emergency":false}}`)
	if status != http.StatusOK {
		t.Fatalf("PUT: status %d (%s), want 200", status, put.Error)
	}
	if !put.State.On || put.State.Until != until || put.State.By != "until" {
		t.Fatalf("PUT state = %+v", put.State)
	}
	if put.Setting.UpdatedBy != governor || put.Setting.UpdatedAt == nil {
		t.Fatalf("PUT stamp = %+v, want the writing key and a time", put.Setting)
	}

	status, got := s.ideas(t, "governor", http.MethodGet, governor, "")
	if status != http.StatusOK || got.Setting.Until != until || got.State != put.State {
		t.Fatalf("GET = %d %+v", status, got)
	}
	if got.Setting.Reaches.Emergency == nil || *got.Setting.Reaches.Emergency {
		t.Fatalf("reaches = %+v, want emergency false kept", got.Setting.Reaches)
	}
}

func itoa(n int64) string {
	b, _ := json.Marshal(n)
	return string(b)
}

func TestAnotherCockpitKeyMayReadButNotWriteAKeysSetting(t *testing.T) {
	clock := &manualClock{now: time.Unix(1_800_000_000, 0)}
	s := newIdeasServer(t, clock, events.NewHub())
	governor := vectorKeyHex(t, "governor")

	status, got := s.ideas(t, "cairnPhone", http.MethodPut, governor, `{"until":1900000000}`)
	if status != http.StatusForbidden {
		t.Fatalf("PUT by another cockpit key: status %d, want 403", status)
	}
	if got.Error == "" {
		t.Fatal("a 403 carries a one-line reason")
	}
	if _, stored := s.ideas(t, "governor", http.MethodGet, governor, ""); stored.State.On {
		t.Fatal("the refused PUT changed the setting")
	}
	if status, _ := s.ideas(t, "cairnPhone", http.MethodGet, governor, ""); status != http.StatusOK {
		t.Fatalf("GET by another cockpit key: status %d, want 200", status)
	}
}

func TestABadSettingIsA400WithAOneLineReason(t *testing.T) {
	clock := &manualClock{now: time.Unix(1_800_000_000, 0)}
	s := newIdeasServer(t, clock, events.NewHub())
	governor := vectorKeyHex(t, "governor")
	for name, body := range map[string]string{
		"a bad tz":                          `{"schedule":{"tz":"Mars/Olympus","windows":[{"days":["sun"],"from":"09:00","to":"21:00"}]}}`,
		"a bad day":                         `{"schedule":{"tz":"America/Chicago","windows":[{"days":["someday"],"from":"09:00","to":"21:00"}]}}`,
		"a bad time":                        `{"schedule":{"tz":"America/Chicago","windows":[{"days":["sun"],"from":"9am","to":"21:00"}]}}`,
		"a window that ends when it starts": `{"schedule":{"tz":"America/Chicago","windows":[{"days":["sun"],"from":"09:00","to":"09:00"}]}}`,
		"not JSON":                          `nope`,
	} {
		status, got := s.ideas(t, "governor", http.MethodPut, governor, body)
		if status != http.StatusBadRequest || got.Error == "" || strings.Contains(got.Error, "\n") {
			t.Errorf("%s: status %d, error %q, want 400 and one line", name, status, got.Error)
		}
	}
	// A window that crosses midnight is fine.
	if status, got := s.ideas(t, "governor", http.MethodPut, governor, `{"schedule":{"tz":"America/Chicago","windows":[{"days":["sat"],"from":"21:00","to":"07:00"}]}}`); status != http.StatusOK {
		t.Errorf("a window across midnight: status %d (%s), want 200", status, got.Error)
	}
	if status, _ := s.ideas(t, "governor", http.MethodPut, "not-a-key", `{}`); status != http.StatusBadRequest && status != http.StatusForbidden {
		t.Errorf("a path that is no key: status %d, want 400 or 403", status)
	}
}

func TestASettingOver16KiBIsA413(t *testing.T) {
	clock := &manualClock{now: time.Unix(1_800_000_000, 0)}
	s := newIdeasServer(t, clock, events.NewHub())
	body := `{"schedule":{"tz":"America/Chicago","windows":[],"pad":"` + strings.Repeat("x", 17*1024) + `"}}`
	if status, _ := s.ideas(t, "governor", http.MethodPut, vectorKeyHex(t, "governor"), body); status != http.StatusRequestEntityTooLarge {
		t.Fatalf("status %d, want 413", status)
	}
}

func TestTheMayorsKeyWithNoLicenceReadsAKeysSetting(t *testing.T) {
	clock := &manualClock{now: time.Unix(1_800_000_000, 0)}
	s := newIdeasServer(t, clock, events.NewHub())
	governor := vectorKeyHex(t, "governor")
	until := clock.now.Unix() + 600
	if status, got := s.ideas(t, "governor", http.MethodPut, governor, `{"until":`+itoa(until)+`}`); status != http.StatusOK {
		t.Fatalf("seeding: %d %s", status, got.Error)
	}
	status, got := s.ideas(t, "stranger", http.MethodGet, governor, "")
	if status != http.StatusOK || got.Setting.Until != until || !got.State.On || got.State.Until != until {
		t.Fatalf("GET as the Mayor = %d %+v", status, got)
	}
	// The Mayor's key may not write another's.
	if status, _ := s.ideas(t, "stranger", http.MethodPut, governor, `{}`); status != http.StatusForbidden {
		t.Fatalf("PUT as the Mayor: status %d, want 403", status)
	}
}

func TestAKeyNeverStoredAnswersAnEmptySettingAndStateOff(t *testing.T) {
	clock := &manualClock{now: time.Unix(1_800_000_000, 0)}
	s := newIdeasServer(t, clock, events.NewHub())
	status, got := s.ideas(t, "governor", http.MethodGet, vectorKeyHex(t, "cairnPhone"), "")
	if status != http.StatusOK || got.State.On || got.State.Until != 0 || got.State.By != "" || got.Setting.Until != 0 {
		t.Fatalf("GET = %d %+v, want 200, empty, off", status, got)
	}
}

func TestAnAppKeyAndTheMillAreRefused(t *testing.T) {
	clock := &manualClock{now: time.Unix(1_800_000_000, 0)}
	s := newIdeasServer(t, clock, events.NewHub())
	if status, _ := s.ideas(t, "mill", http.MethodGet, vectorKeyHex(t, "governor"), ""); status != http.StatusForbidden {
		t.Fatalf("GET as the mill: status %d, want 403", status)
	}
}

func TestWithNoStoreTheRoutesAnswer501(t *testing.T) {
	s := newGristServer(t)
	if status, _ := s.ideas(t, "governor", http.MethodGet, vectorKeyHex(t, "governor"), ""); status != http.StatusNotImplemented {
		t.Fatalf("status %d, want 501", status)
	}
}

func TestThePutThatTurnsItOnSendsOneIdeasOnlyEventAndTheClockPassingUntilSendsOff(t *testing.T) {
	clock := &manualClock{now: time.Unix(1_800_000_000, 0)}
	hub := events.NewHub()
	s := newIdeasServer(t, clock, hub)
	governor := vectorKeyHex(t, "governor")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	priv, _ := s.v.key(t, "governor")
	_, frames := openStream(t, ctx, s.URL, v2As(t, s.Server, priv, "GET", "/api/events", nil))
	if hello := nextEvent(t, frames); hello.name != "hello" {
		t.Fatalf("first frame = %+v", hello)
	}

	until := clock.now.Unix() + 3600
	s.ideas(t, "governor", http.MethodPut, governor, `{"until":`+itoa(until)+`}`)
	on := nextEvent(t, frames)
	if want := `{"key":"` + governor + `","on":true,"until":` + itoa(until) + `}`; on.name != "ideas-only" || on.data != want {
		t.Fatalf("event = %+v, want ideas-only %s", on, want)
	}

	// A PUT that changes no state sends nothing.
	s.ideas(t, "governor", http.MethodPut, governor, `{"until":`+itoa(until)+`,"reaches":{"ring":false}}`)

	clock.Advance(2 * time.Hour)
	off := nextEvent(t, frames)
	if want := `{"key":"` + governor + `","on":false,"until":0}`; off.name != "ideas-only" || off.data != want {
		t.Fatalf("event = %+v, want ideas-only %s (and nothing between: the no-change PUT sent none)", off, want)
	}
}
