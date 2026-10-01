package auth

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/licence"
)

// After a backend restart a key's earlier answer is served at once and
// refreshed in the background, never waited for behind a cold walk over the
// chain (mw-gq6.215).

// firstLife runs a first backend life that learns key's collections and
// returns the answers file it left, for a restart to start from.
func firstLife(t *testing.T, key string, collections []string, opts ...CachedCheckerOption) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "licence-answers.json")
	script := &walkScript{answers: []walkAnswer{{collections: collections}}}
	checker := NewCachedChecker(&countingReader{}, time.Minute, append(opts, WithPersistence(path), withWalk(script.walk))...)
	if got, err := checker.HeldCollections(key); err != nil || !reflect.DeepEqual(got, collections) {
		t.Fatalf("first life: %v, %v", got, err)
	}
	return path
}

// settle registers, after the test's TempDir, a wait for checker's background
// refreshes, so none is still writing the answers file when the TempDir is
// removed (cleanups run last-in first).
func settle(t *testing.T, checker *CachedChecker) {
	t.Helper()
	t.Cleanup(checker.Wait)
}

// keptAnswer reads what the answers file at path holds for key by starting a
// checker from it, without asking it anything: asking would start a walk that
// writes the file again.
func keptAnswer(path, key string) ([]string, bool) {
	entry, ok := NewCachedChecker(&countingReader{}, time.Minute, WithPersistence(path)).cache[key]
	return entry.collections, ok
}

func TestARestartedCheckerServesTheEarlierAnswerAtOnceAndRefreshesInTheBackground(t *testing.T) {
	key := testPubKeyHex(t)
	path := firstLife(t, key, []string{"postern"})

	chain := &blockingReader{release: make(chan struct{})} // the chain answers nothing
	defer close(chain.release)
	checker := NewCachedChecker(chain, time.Minute, WithPersistence(path))
	settle(t, checker)

	done := make(chan []string, 1)
	go func() {
		got, _ := checker.HeldCollections(key)
		done <- got
	}()
	select {
	case got := <-done:
		if !reflect.DeepEqual(got, []string{"postern"}) {
			t.Fatalf("after the restart = %v, want the earlier answer", got)
		}
	case <-time.After(time.Second):
		t.Fatal("the first check after a restart waited on the chain, want the earlier answer within 1 s")
	}
	waitFor(t, func() bool { return chain.calls.Load() >= 1 }) // the refresh went to the chain
}

func TestAnEarlierAnswerOlderThanTheGraceIsStillServedAtOnceAfterARestart(t *testing.T) {
	key := testPubKeyHex(t)
	clock := &fakeClock{now: time.Unix(1_700_000_000, 0)}
	path := firstLife(t, key, []string{"postern"}, WithCheckerClock(clock.Now))

	clock.Advance(48 * time.Hour) // the backend was down for two days
	chain := &blockingReader{release: make(chan struct{})}
	defer close(chain.release)
	checker := NewCachedChecker(chain, time.Minute, WithPersistence(path), WithCheckerClock(clock.Now))
	settle(t, checker)

	for i := 0; i < 3; i++ { // and again while the refresh is still running
		done := make(chan []string, 1)
		go func() {
			got, _ := checker.HeldCollections(key)
			done <- got
		}()
		select {
		case got := <-done:
			if !reflect.DeepEqual(got, []string{"postern"}) {
				t.Fatalf("check %d = %v, want the earlier answer", i, got)
			}
		case <-time.After(time.Second):
			t.Fatalf("check %d waited on the chain", i)
		}
	}
	if got := chain.calls.Load(); got > 1 {
		t.Fatalf("walks = %d, want one shared refresh", got)
	}
}

func TestARefreshAfterARestartReplacesTheEarlierAnswerAndIsKept(t *testing.T) {
	key := testPubKeyHex(t)
	path := firstLife(t, key, []string{"postern"})

	script := &walkScript{answers: []walkAnswer{{collections: nil}}} // the licence is gone
	checker := NewCachedChecker(&countingReader{}, time.Minute, WithPersistence(path), withWalk(script.walk))
	settle(t, checker)
	checker.HeldCollections(key)
	waitFor(t, func() bool {
		got, _ := checker.HeldCollections(key)
		return len(got) == 0
	})

	checker.Wait() // the refresh has written its file
	if got, ok := keptAnswer(path, key); ok {
		t.Fatalf("the file still holds %v, want no answer: the licence is gone", got)
	}
}

func TestWaitReturnsOnlyOnceTheBackgroundRefreshHasKeptItsAnswer(t *testing.T) {
	key := testPubKeyHex(t)
	path := firstLife(t, key, []string{"postern"})

	script := &walkScript{answers: []walkAnswer{{collections: nil}}, gate: make(chan struct{})}
	checker := NewCachedChecker(&countingReader{}, time.Minute, WithPersistence(path), withWalk(script.walk))
	if got, _ := checker.HeldCollections(key); !reflect.DeepEqual(got, []string{"postern"}) {
		t.Fatalf("after the restart = %v, want the earlier answer", got)
	}
	waitFor(t, func() bool { return script.calls.Load() == 1 }) // the refresh is held at the gate

	waited := make(chan struct{})
	go func() {
		checker.Wait()
		close(waited)
	}()
	select {
	case <-waited:
		t.Fatal("Wait returned while a refresh was still in flight")
	case <-time.After(20 * time.Millisecond):
	}

	close(script.gate)
	select {
	case <-waited:
	case <-time.After(5 * time.Second):
		t.Fatal("Wait did not return after the refresh finished")
	}
	// no polling: once Wait has returned the refresh has written its file
	if _, ok := keptAnswer(path, key); ok {
		t.Fatal("the file still holds the answer after Wait: the refresh had not finished writing")
	}
}

func TestAnAnswerKeptUnderAnotherRuleIsNotServed(t *testing.T) {
	key := testPubKeyHex(t)
	path := firstLife(t, key, []string{"postern"}, WithRule(licence.Rule{Collections: []string{"postern"}}))

	chain := &blockingReader{release: make(chan struct{})}
	defer close(chain.release)
	checker := NewCachedChecker(chain, time.Minute, WithPersistence(path), WithRule(licence.Rule{Collections: []string{"other"}}))
	settle(t, checker)
	if got, ok := checker.CachedCollections(key); ok {
		t.Fatalf("CachedCollections = %v, true; want no answer once the collections changed", got)
	}
}

func TestAnUnreadableAnswersFileStartsColdWithoutFailing(t *testing.T) {
	path := filepath.Join(t.TempDir(), "licence-answers.json")
	if err := writeFile(path, "{not json"); err != nil {
		t.Fatal(err)
	}
	key := testPubKeyHex(t)
	script := &walkScript{answers: []walkAnswer{{collections: []string{"postern"}}}}
	checker := NewCachedChecker(&countingReader{}, time.Minute, WithPersistence(path), withWalk(script.walk))
	if got, err := checker.HeldCollections(key); err != nil || !reflect.DeepEqual(got, []string{"postern"}) {
		t.Fatalf("HeldCollections = %v, %v", got, err)
	}
}

func TestCachedCollectionsNeverWaitsAndWarmsAColdKey(t *testing.T) {
	chain := &blockingReader{release: make(chan struct{})}
	defer close(chain.release)
	checker := NewCachedChecker(chain, time.Minute)
	settle(t, checker)
	key := testPubKeyHex(t)

	if got, ok := checker.CachedCollections(key); ok {
		t.Fatalf("CachedCollections = %v, true for a key never checked", got)
	}
	waitFor(t, func() bool { return chain.calls.Load() == 1 }) // the walk it started
	checker.CachedCollections(key)
	time.Sleep(20 * time.Millisecond)
	if got := chain.calls.Load(); got != 1 {
		t.Fatalf("walks = %d, want the one in flight shared", got)
	}
}

func writeFile(path, content string) error { return os.WriteFile(path, []byte(content), 0o600) }
