package auth

import (
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/chain"
	"github.com/Jonathan-A-White/postern/server/internal/licence"
)

// A long-lived key's licence check must not turn into a 502 on every send:
// a rate limit backs the refresh off, a history too long to read keeps the
// last good answer, and the mint is remembered (mw-gq6.305).

// findScript scripts licence.Find: each call takes the next outcome and
// records what the checker remembered and handed it.
type findScript struct {
	mu       sync.Mutex
	outcomes []findOutcome
	known    [][]licence.Mint
}

type findOutcome struct {
	result licence.Result
	err    error
}

func (f *findScript) find(_ string, known []licence.Mint) (licence.Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.known = append(f.known, known)
	i := len(f.known) - 1
	if i >= len(f.outcomes) {
		i = len(f.outcomes) - 1
	}
	return f.outcomes[i].result, f.outcomes[i].err
}

func (f *findScript) calls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.known)
}

var rateLimited = &chain.ProviderError{Provider: "WhatsOnChain", Status: 429}

func licensed(collections ...string) findOutcome {
	return findOutcome{result: licence.Result{Collections: collections}}
}

func newFindChecker(script *findScript, clock *fakeClock, opts ...CachedCheckerOption) *CachedChecker {
	return NewCachedChecker(&countingReader{}, time.Minute, append(opts,
		WithCheckerClock(clock.Now),
		WithStaleGrace(time.Hour),
		withFind(script.find))...)
}

func TestARateLimitedRefreshKeepsTheLastAnswerAndIsNotRetriedForTheGrace(t *testing.T) {
	script := &findScript{outcomes: []findOutcome{licensed("postern"), {err: fmt.Errorf("getting history: %w", rateLimited)}, licensed("postern")}}
	clock := &fakeClock{now: time.Unix(1_700_000_000, 0)}
	checker := newFindChecker(script, clock)
	settle(t, checker)
	key := testPubKeyHex(t)

	if got, err := checker.HeldCollections(key); err != nil || !reflect.DeepEqual(got, []string{"postern"}) {
		t.Fatalf("first check = %v, %v", got, err)
	}

	clock.Advance(2 * time.Minute) // past the ttl: the next ask refreshes
	if got, err := checker.HeldCollections(key); err != nil || !reflect.DeepEqual(got, []string{"postern"}) {
		t.Fatalf("stale check = %v, %v; want the last answer", got, err)
	}
	waitFor(t, func() bool { return script.calls() == 2 && !checker.refreshing(key) })

	// Every minute for most of the grace: the answer stands and the chain is left alone.
	for i := 0; i < 50; i++ {
		clock.Advance(time.Minute)
		if got, err := checker.HeldCollections(key); err != nil || !reflect.DeepEqual(got, []string{"postern"}) {
			t.Fatalf("check %d in the backoff = %v, %v; want the last answer", i, got, err)
		}
	}
	checker.Wait()
	if got := script.calls(); got != 2 {
		t.Fatalf("find calls = %d, want 2: no retry inside the grace after a 429", got)
	}

	// Past the grace the backoff is over and the chain is asked again.
	clock.Advance(2 * time.Hour)
	if got, err := checker.HeldCollections(key); err != nil || !reflect.DeepEqual(got, []string{"postern"}) {
		t.Fatalf("check after the backoff = %v, %v", got, err)
	}
	if got := script.calls(); got != 3 {
		t.Fatalf("find calls = %d, want 3 once the backoff is over", got)
	}
}

func TestAHistoryTooLongToReadKeepsTheLastAnswerPastTheGrace(t *testing.T) {
	tooLong := fmt.Errorf("getting history: %w", &chain.HistoryTooLongError{Address: "mnSCD84w", Pages: 200})
	script := &findScript{outcomes: []findOutcome{licensed("postern"), {err: tooLong}}}
	clock := &fakeClock{now: time.Unix(1_700_000_000, 0)}
	checker := newFindChecker(script, clock)
	settle(t, checker)
	key := testPubKeyHex(t)

	if _, err := checker.HeldCollections(key); err != nil {
		t.Fatalf("first check: %v", err)
	}
	clock.Advance(2 * time.Minute)
	if _, err := checker.HeldCollections(key); err != nil {
		t.Fatalf("stale check: %v", err)
	}
	waitFor(t, func() bool { return script.calls() == 2 && !checker.refreshing(key) })

	for _, wait := range []time.Duration{30 * time.Minute, 3 * time.Hour, 24 * time.Hour, 24 * time.Hour} {
		clock.Advance(wait)
		got, err := checker.HeldCollections(key)
		if err != nil || !reflect.DeepEqual(got, []string{"postern"}) {
			t.Fatalf("check %s later = %v, %v; want the last answer, never a failure", wait, got, err)
		}
	}
	checker.Wait()
}

func TestAnErrorTheCallerSeesNamesTheKeyAndWhatToDo(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want []string
	}{
		{"too long", fmt.Errorf("getting history: %w", &chain.HistoryTooLongError{Address: "mnSCD84w", Pages: 200}), []string{"POSTERN_ISSUER_KEY", "mnSCD84w"}},
		{"rate limited", fmt.Errorf("getting history: %w", rateLimited), []string{"rate-limiting", "try again"}},
		{"other", errors.New("boom"), []string{"boom"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			script := &findScript{outcomes: []findOutcome{{err: tc.err}}}
			clock := &fakeClock{now: time.Unix(1_700_000_000, 0)}
			checker := newFindChecker(script, clock)
			key := testPubKeyHex(t)

			_, err := checker.HeldCollections(key)
			if err == nil {
				t.Fatal("HeldCollections succeeded, want the failure")
			}
			if !strings.Contains(err.Error(), key) {
				t.Errorf("error %q does not name the key %s", err, key)
			}
			for _, want := range tc.want {
				if !strings.Contains(err.Error(), want) {
					t.Errorf("error %q lacks %q", err, want)
				}
			}
		})
	}
}

func TestAColdKeyBackedOffIsAnsweredWithoutAskingTheChainAgain(t *testing.T) {
	script := &findScript{outcomes: []findOutcome{{err: rateLimited}}}
	clock := &fakeClock{now: time.Unix(1_700_000_000, 0)}
	checker := newFindChecker(script, clock)
	key := testPubKeyHex(t)

	for i := 0; i < 5; i++ {
		if _, err := checker.HeldCollections(key); err == nil {
			t.Fatal("HeldCollections succeeded, want the rate limit")
		}
		clock.Advance(time.Minute)
	}
	if got := script.calls(); got != 1 {
		t.Fatalf("find calls = %d, want 1: a 429 is not retried inside the grace", got)
	}
}

func TestTheMintIsRememberedAndHandedToTheNextRefresh(t *testing.T) {
	mint := licence.Mint{Txid: strings.Repeat("ab", 32), Collection: "postern"}
	script := &findScript{outcomes: []findOutcome{
		{result: licence.Result{Collections: []string{"postern"}, Mints: []licence.Mint{mint}}},
		licensed("postern"),
	}}
	clock := &fakeClock{now: time.Unix(1_700_000_000, 0)}
	checker := newFindChecker(script, clock)
	settle(t, checker)
	key := testPubKeyHex(t)

	if _, err := checker.HeldCollections(key); err != nil {
		t.Fatalf("first check: %v", err)
	}
	clock.Advance(2 * time.Minute)
	if _, err := checker.HeldCollections(key); err != nil {
		t.Fatalf("second check: %v", err)
	}
	waitFor(t, func() bool { return script.calls() == 2 && !checker.refreshing(key) })

	if len(script.known[0]) != 0 {
		t.Fatalf("first find was told %v, want nothing remembered", script.known[0])
	}
	if want := []licence.Mint{mint}; !reflect.DeepEqual(script.known[1], want) {
		t.Fatalf("second find was told %v, want %v", script.known[1], want)
	}
}

func TestTheRememberedMintSurvivesARestart(t *testing.T) {
	mint := licence.Mint{Txid: strings.Repeat("cd", 32), Collection: "postern"}
	path := filepath.Join(t.TempDir(), "licence-answers.json")
	key := testPubKeyHex(t)
	clock := &fakeClock{now: time.Unix(1_700_000_000, 0)}

	first := &findScript{outcomes: []findOutcome{{result: licence.Result{Collections: []string{"postern"}, Mints: []licence.Mint{mint}}}}}
	checker := newFindChecker(first, clock, WithPersistence(path))
	if _, err := checker.HeldCollections(key); err != nil {
		t.Fatalf("first life: %v", err)
	}

	second := &findScript{outcomes: []findOutcome{licensed("postern")}}
	restarted := newFindChecker(second, clock, WithPersistence(path))
	settle(t, restarted)
	if _, err := restarted.HeldCollections(key); err != nil {
		t.Fatalf("second life: %v", err)
	}
	waitFor(t, func() bool { return second.calls() == 1 && !restarted.refreshing(key) })
	if want := []licence.Mint{mint}; !reflect.DeepEqual(second.known[0], want) {
		t.Fatalf("the restarted checker's first find was told %v, want the kept mint %v", second.known[0], want)
	}
}
