package ideasonly

import (
	"os"
	"path/filepath"
	"sort"
	"sync"
	"testing"
	"time"
)

// fakeClock is a clock a test moves: timers armed with it fire, in order,
// as Advance passes them.
type fakeClock struct {
	mu     sync.Mutex
	now    time.Time
	timers map[int]*fakeTimer
	next   int
}

type fakeTimer struct {
	at time.Time
	f  func()
}

func newFakeClock(now time.Time) *fakeClock {
	return &fakeClock{now: now, timers: map[int]*fakeTimer{}}
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) AfterFunc(d time.Duration, f func()) (stop func()) {
	c.mu.Lock()
	defer c.mu.Unlock()
	id := c.next
	c.next++
	c.timers[id] = &fakeTimer{at: c.now.Add(d), f: f}
	return func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		delete(c.timers, id)
	}
}

func (c *fakeClock) pending() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.timers)
}

// Advance moves the clock by d, firing every timer that falls due on the way.
func (c *fakeClock) Advance(d time.Duration) {
	target := c.Now().Add(d)
	for {
		c.mu.Lock()
		ids := make([]int, 0, len(c.timers))
		for id, tm := range c.timers {
			if !tm.at.After(target) {
				ids = append(ids, id)
			}
		}
		if len(ids) == 0 {
			c.now = target
			c.mu.Unlock()
			return
		}
		sort.Slice(ids, func(i, j int) bool { return c.timers[ids[i]].at.Before(c.timers[ids[j]].at) })
		tm := c.timers[ids[0]]
		delete(c.timers, ids[0])
		if tm.at.After(c.now) {
			c.now = tm.at
		}
		c.mu.Unlock()
		tm.f()
	}
}

type change struct {
	key string
	st  Status
}

type recorder struct {
	mu   sync.Mutex
	list []change
}

func (r *recorder) publish(key string, st Status) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.list = append(r.list, change{key, st})
}

func (r *recorder) all() []change {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]change(nil), r.list...)
}

const keyA = "02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func openWith(t *testing.T, dir string, clock *fakeClock, rec *recorder) *Store {
	t.Helper()
	store, err := OpenStore(dir, WithClock(clock.Now, clock.AfterFunc), WithPublish(rec.publish))
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	t.Cleanup(store.Stop)
	return store
}

func TestAKeyNeverStoredAnswersAnEmptySettingAndStateOff(t *testing.T) {
	store := openWith(t, t.TempDir(), newFakeClock(time.Unix(1_800_000_000, 0)), &recorder{})
	setting, state := store.Get(keyA)
	if setting.Until != 0 || setting.Schedule != nil || state.On {
		t.Fatalf("Get = %+v, %+v, want empty and off", setting, state)
	}
}

func TestPutThatTurnsTheModeOnPublishesOnceAndTheClockPassingUntilPublishesOff(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	clock, rec := newFakeClock(now), &recorder{}
	store := openWith(t, t.TempDir(), clock, rec)

	until := now.Unix() + 3600
	state, err := store.Put(keyA, Setting{Until: until})
	if err != nil {
		t.Fatalf("Put: %v", err)
	}
	if want := (Status{On: true, Until: until, By: ByUntil}); state != want {
		t.Fatalf("Put state = %+v, want %+v", state, want)
	}
	if got := rec.all(); len(got) != 1 || got[0].key != keyA || got[0].st.On != true || got[0].st.Until != until {
		t.Fatalf("after Put: events = %+v, want one on event with until", got)
	}

	clock.Advance(59 * time.Minute)
	if got := rec.all(); len(got) != 1 {
		t.Fatalf("before until: events = %+v, want still one", got)
	}
	clock.Advance(2 * time.Minute)
	got := rec.all()
	if len(got) != 2 || got[1].st.On || got[1].st.Until != 0 {
		t.Fatalf("after until: events = %+v, want a second, off", got)
	}
	if clock.pending() != 0 {
		t.Fatalf("%d timers still armed with nothing left to wait for", clock.pending())
	}
}

func TestAPutThatChangesNoStatePublishesNothing(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	clock, rec := newFakeClock(now), &recorder{}
	store := openWith(t, t.TempDir(), clock, rec)

	// Off to off: only the reaches change.
	no := false
	if _, err := store.Put(keyA, Setting{Reaches: Reaches{Ring: &no}}); err != nil {
		t.Fatal(err)
	}
	// On, then the same until again.
	until := now.Unix() + 600
	store.Put(keyA, Setting{Until: until})
	store.Put(keyA, Setting{Until: until, Reaches: Reaches{Emergency: &no}})
	if got := rec.all(); len(got) != 1 {
		t.Fatalf("events = %+v, want exactly one (the first turning on)", got)
	}
	// A new until changes the state: one more.
	store.Put(keyA, Setting{Until: until + 600})
	if got := rec.all(); len(got) != 2 || got[1].st.Until != until+600 {
		t.Fatalf("events = %+v, want a second with the new until", got)
	}
}

func TestEndNowIsAPutThatTurnsItOff(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	clock, rec := newFakeClock(now), &recorder{}
	store := openWith(t, t.TempDir(), clock, rec)
	store.Put(keyA, Setting{Until: now.Unix() + 3600})
	store.Put(keyA, Setting{})
	got := rec.all()
	if len(got) != 2 || got[1].st.On {
		t.Fatalf("events = %+v, want on then off", got)
	}
	clock.Advance(2 * time.Hour)
	if len(rec.all()) != 2 {
		t.Fatalf("the old until fired after End now: %+v", rec.all())
	}
}

func TestAScheduleBringsItsOwnEdgesWithNoPutInBetween(t *testing.T) {
	loc := chicago(t)
	clock, rec := newFakeClock(at(loc, 2026, time.October, 10, 12, 0)), &recorder{} // Saturday noon
	store := openWith(t, t.TempDir(), clock, rec)

	if _, err := store.Put(keyA, sundayWindow("09:00", "21:00")); err != nil {
		t.Fatal(err)
	}
	if got := rec.all(); len(got) != 0 {
		t.Fatalf("a schedule not yet in a window published %+v", got)
	}
	clock.Advance(22 * time.Hour) // Sunday 10:00
	start := rec.all()
	if len(start) != 1 || !start[0].st.On || start[0].st.Until != at(loc, 2026, time.October, 11, 21, 0).Unix() {
		t.Fatalf("at the window's start: events = %+v", start)
	}
	clock.Advance(12 * time.Hour) // Sunday 22:00
	end := rec.all()
	if len(end) != 2 || end[1].st.On {
		t.Fatalf("at the window's end: events = %+v", end)
	}
	// And the next Sunday's start is armed.
	clock.Advance(6*24*time.Hour + 12*time.Hour) // the following Sunday 10:00
	if got := rec.all(); len(got) != 3 || !got[2].st.On {
		t.Fatalf("a week on: events = %+v", got)
	}
}

func TestARestartKeepsTheSettingAndRearmsFromTheFile(t *testing.T) {
	dir := t.TempDir()
	now := time.Unix(1_800_000_000, 0)
	until := now.Unix() + 3600
	first := openWith(t, dir, newFakeClock(now), &recorder{})
	if _, err := first.Put(keyA, Setting{Until: until, UpdatedBy: "k"}); err != nil {
		t.Fatal(err)
	}
	first.Stop()

	clock, rec := newFakeClock(now.Add(time.Minute)), &recorder{}
	second := openWith(t, dir, clock, rec)
	second.Start()
	setting, state := second.Get(keyA)
	if setting.Until != until || setting.UpdatedBy != "k" || !state.On {
		t.Fatalf("after restart: %+v %+v", setting, state)
	}
	if len(rec.all()) != 0 {
		t.Fatalf("a restart that changes nothing published %+v", rec.all())
	}
	clock.Advance(time.Hour)
	if got := rec.all(); len(got) != 1 || got[0].st.On {
		t.Fatalf("after restart, the clock passing until: events = %+v, want one off", got)
	}
}

func TestTheKeyIsLowerCasedAndTheFileIsPrivate(t *testing.T) {
	dir := t.TempDir()
	store := openWith(t, dir, newFakeClock(time.Unix(1_800_000_000, 0)), &recorder{})
	if _, err := store.Put("02AAAA", Setting{Until: 1_900_000_000}); err != nil {
		t.Fatal(err)
	}
	if s, _ := store.Get("02aaaa"); s.Until != 1_900_000_000 {
		t.Fatalf("Get by the lower-cased key found %+v", s)
	}
	info, err := os.Stat(filepath.Join(dir, "ideas-only.json"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %v, want 0600", info.Mode().Perm())
	}
}
