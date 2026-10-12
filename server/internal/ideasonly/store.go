package ideasonly

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const fileName = "ideas-only.json"

// Store is the durable set of settings, one per key, persisted whole as
// dir/ideas-only.json (written to a temp file and renamed into place), with a
// timer per key that wakes at the next moment its state can change. Every
// change of state, by Put or by the clock, goes to the publisher. Safe for
// concurrent use.
type Store struct {
	path    string
	now     func() time.Time
	after   func(d time.Duration, f func()) (stop func())
	publish func(key string, st Status)

	mu    sync.Mutex
	byKey map[string]Setting
	last  map[string]Status // the state last published (or found at start) per key
	stops map[string]func() // each key's armed timer
	done  bool
}

// Option configures OpenStore.
type Option func(*Store)

// WithClock sets the clock and the timer the store runs on (time.Now and
// time.AfterFunc by default).
func WithClock(now func() time.Time, after func(d time.Duration, f func()) (stop func())) Option {
	return func(s *Store) { s.now, s.after = now, after }
}

// WithPublish sets what is told of every change of a key's state.
func WithPublish(publish func(key string, st Status)) Option {
	return func(s *Store) { s.publish = publish }
}

// OpenStore loads dir/ideas-only.json (starting empty if it does not exist
// yet). It arms nothing until Start.
func OpenStore(dir string, opts ...Option) (*Store, error) {
	s := &Store{
		path:  filepath.Join(dir, fileName),
		now:   time.Now,
		after: func(d time.Duration, f func()) func() { t := time.AfterFunc(d, f); return func() { t.Stop() } },
		byKey: map[string]Setting{},
		last:  map[string]Status{},
		stops: map[string]func(){},
	}
	for _, opt := range opts {
		opt(s)
	}
	data, err := os.ReadFile(s.path)
	if os.IsNotExist(err) {
		return s, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", s.path, err)
	}
	if err := json.Unmarshal(data, &s.byKey); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", s.path, err)
	}
	return s, nil
}

// Start arms a timer for every key in the file, taking each key's present
// state as already known: a restart announces nothing, it only waits for the
// next edge.
func (s *Store) Start() {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	for key, setting := range s.byKey {
		s.last[key] = State(setting, now)
		s.arm(key, setting, now)
	}
}

// Stop cancels every timer and publishes nothing more.
func (s *Store) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.done = true
	for key, stop := range s.stops {
		stop()
		delete(s.stops, key)
	}
}

// Get returns key's setting (empty if none was stored) and its state now.
func (s *Store) Get(key string) (Setting, Status) {
	key = strings.ToLower(key)
	s.mu.Lock()
	defer s.mu.Unlock()
	setting := s.byKey[key]
	return setting, State(setting, s.now())
}

// Put stores setting as key's, re-arms key's timer, and publishes the new
// state if it differs from the last one. The caller has validated and stamped
// it. It answers the state now.
func (s *Store) Put(key string, setting Setting) (Status, error) {
	key = strings.ToLower(key)
	s.mu.Lock()
	previous, had := s.byKey[key]
	now := s.now()
	was, known := s.last[key]
	if !known {
		was = State(previous, now)
	}
	s.byKey[key] = setting
	if err := s.save(); err != nil {
		if had {
			s.byKey[key] = previous
		} else {
			delete(s.byKey, key)
		}
		s.mu.Unlock()
		return Status{}, err
	}
	state := State(setting, now)
	s.last[key] = state
	s.arm(key, setting, now)
	s.mu.Unlock()
	if state != was && s.publish != nil {
		s.publish(key, state)
	}
	return state, nil
}

// arm sets key's timer for the next moment its state can change: the end of
// the mode while it is on, else the start of the next window. Callers must
// hold s.mu.
func (s *Store) arm(key string, setting Setting, now time.Time) {
	if stop := s.stops[key]; stop != nil {
		stop()
		delete(s.stops, key)
	}
	if s.done {
		return
	}
	var edge time.Time
	if st := State(setting, now); st.On {
		edge = time.Unix(st.Until, 0)
	} else if next, ok := NextStart(setting, now); ok {
		edge = next
	} else {
		return
	}
	s.stops[key] = s.after(edge.Sub(now), func() { s.edge(key) })
}

// edge runs when key's timer fires: it works out the state now, tells the
// publisher if it changed, and arms the timer for the edge after.
func (s *Store) edge(key string) {
	s.mu.Lock()
	if s.done {
		s.mu.Unlock()
		return
	}
	setting, ok := s.byKey[key]
	if !ok {
		s.mu.Unlock()
		return
	}
	now := s.now()
	state := State(setting, now)
	changed := state != s.last[key]
	s.last[key] = state
	s.arm(key, setting, now)
	s.mu.Unlock()
	if changed && s.publish != nil {
		s.publish(key, state)
	}
}

// save writes every setting to a temp file beside the real one and renames it
// into place, so a reader never sees a partial file. Callers must hold s.mu.
func (s *Store) save() error {
	data, err := json.Marshal(s.byKey)
	if err != nil {
		return fmt.Errorf("marshaling ideas-only settings: %w", err)
	}
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating data directory: %w", err)
	}
	tmp, err := os.CreateTemp(dir, "ideas-only-*.tmp")
	if err != nil {
		return fmt.Errorf("creating temp file: %w", err)
	}
	tmpPath := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("writing temp file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("closing temp file: %w", err)
	}
	if err := os.Chmod(tmpPath, 0o600); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("setting permissions: %w", err)
	}
	if err := os.Rename(tmpPath, s.path); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("renaming into place: %w", err)
	}
	return nil
}
