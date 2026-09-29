package auth

import (
	"errors"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// blockingReader parks every GetHistory until released, counting the walks
// that start, so a test can hold a cold walk open while more checks arrive.
type blockingReader struct {
	countingReader
	calls   atomic.Int32
	release chan struct{}
}

func (r *blockingReader) GetHistory(address string) ([]woc.HistoryEntry, error) {
	r.calls.Add(1)
	<-r.release
	return nil, nil
}

func TestConcurrentColdChecksOfOneKeyShareOneWalk(t *testing.T) {
	reader := &blockingReader{release: make(chan struct{})}
	checker := NewCachedChecker(reader, time.Minute)
	pubKeyHex := testPubKeyHex(t)

	const callers = 10
	var wg sync.WaitGroup
	errs := make(chan error, callers)
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := checker.Held(pubKeyHex)
			errs <- err
		}()
	}
	// Let the first walk start and the others pile up behind it.
	waitFor(t, func() bool { return reader.calls.Load() >= 1 })
	time.Sleep(50 * time.Millisecond)
	close(reader.release)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("Held: %v", err)
		}
	}
	if got := reader.calls.Load(); got != 1 {
		t.Fatalf("chain walks = %d, want 1 for 10 concurrent checks", got)
	}
}

// walkScript is a stand-in for the chain walk: each call takes the next
// scripted outcome, and blocks on gate when one is set.
type walkScript struct {
	mu      sync.Mutex
	answers []walkAnswer
	calls   atomic.Int32
	gate    chan struct{}
}

type walkAnswer struct {
	collections []string
	err         error
}

func (w *walkScript) walk(string) ([]string, error) {
	n := int(w.calls.Add(1))
	if w.gate != nil {
		<-w.gate
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	i := n - 1
	if i >= len(w.answers) {
		i = len(w.answers) - 1
	}
	return w.answers[i].collections, w.answers[i].err
}

type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

func newSWRChecker(script *walkScript, clock *fakeClock) *CachedChecker {
	return NewCachedChecker(&countingReader{}, time.Minute,
		WithCheckerClock(clock.Now),
		WithStaleGrace(time.Hour),
		withWalk(script.walk))
}

func TestExpiredEntryIsServedAtOnceWhileOneRefreshRuns(t *testing.T) {
	script := &walkScript{answers: []walkAnswer{
		{collections: []string{"postern"}},
		{collections: []string{"other"}},
	}}
	clock := &fakeClock{now: time.Unix(1_700_000_000, 0)}
	checker := newSWRChecker(script, clock)
	key := testPubKeyHex(t)

	if got, err := checker.HeldCollections(key); err != nil || !reflect.DeepEqual(got, []string{"postern"}) {
		t.Fatalf("first check = %v, %v", got, err)
	}

	clock.Advance(2 * time.Minute) // past the TTL
	script.gate = make(chan struct{})
	for i := 0; i < 5; i++ {
		got, err := checker.HeldCollections(key)
		if err != nil || !reflect.DeepEqual(got, []string{"postern"}) {
			t.Fatalf("stale check %d = %v, %v; want the cached answer at once", i, got, err)
		}
	}
	waitFor(t, func() bool { return script.calls.Load() == 2 })
	close(script.gate)
	// The refresh lands: the new answer is served, and only one refresh ran.
	waitFor(t, func() bool {
		got, _ := checker.HeldCollections(key)
		return reflect.DeepEqual(got, []string{"other"})
	})
	if got := script.calls.Load(); got != 2 {
		t.Fatalf("walks = %d, want 2 (first check plus one background refresh)", got)
	}
}

func TestFailedRefreshKeepsTheLastAnswerWithinGraceAndDropsItAfter(t *testing.T) {
	boom := errors.New("woc down")
	script := &walkScript{answers: []walkAnswer{
		{collections: []string{"postern"}},
		{err: boom},
	}}
	clock := &fakeClock{now: time.Unix(1_700_000_000, 0)}
	checker := newSWRChecker(script, clock)
	key := testPubKeyHex(t)

	if _, err := checker.HeldCollections(key); err != nil {
		t.Fatalf("first check: %v", err)
	}

	clock.Advance(2 * time.Minute)
	if got, err := checker.HeldCollections(key); err != nil || !reflect.DeepEqual(got, []string{"postern"}) {
		t.Fatalf("stale check = %v, %v", got, err)
	}
	waitFor(t, func() bool { return script.calls.Load() == 2 })
	// The failed refresh changed nothing: still served within the grace.
	waitFor(t, func() bool { return !checker.refreshing(key) })
	clock.Advance(30 * time.Minute)
	if got, err := checker.HeldCollections(key); err != nil || !reflect.DeepEqual(got, []string{"postern"}) {
		t.Fatalf("check within grace = %v, %v; want the last good answer", got, err)
	}

	// Past the grace the answer is dropped: the check walks the chain
	// itself, and its failure reaches the caller.
	waitFor(t, func() bool { return !checker.refreshing(key) })
	clock.Advance(2 * time.Hour)
	if got, err := checker.HeldCollections(key); !errors.Is(err, boom) {
		t.Fatalf("check after grace = %v, %v; want the walk's error", got, err)
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not reached in time")
		}
		time.Sleep(time.Millisecond)
	}
}
