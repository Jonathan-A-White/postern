// Package watchdog is `postern watchdog`: run once a minute by a systemd
// timer on the VPS, it makes one GET of the desktop backend's /healthz and
// pushes an alarm to every subscribed device when the desktop has been
// unreachable longer than a grace period, and again when it is back. Its
// state between runs is one small JSON file.
package watchdog

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"time"
)

const (
	// DefaultAfter is how long the target must be down before the alarm.
	DefaultAfter = 3 * time.Minute
	// DefaultName names the target in the alarm's title.
	DefaultName = "desktop"
	// CheckTimeout bounds the one GET a run makes.
	CheckTimeout = 10 * time.Second

	defaultDataDir    = "./data"
	defaultSubscriber = "https://postern.allmymind.org"
	stateFileName     = "watchdog-state.json"
)

// Config is the watchdog's environment-derived configuration.
type Config struct {
	URL        string        // POSTERN_WATCH_URL — required, e.g. http://desktop.mw:8787/healthz
	After      time.Duration // POSTERN_WATCH_AFTER
	Name       string        // POSTERN_WATCH_NAME
	DataDir    string        // POSTERN_DATA: the push keys and subscriptions, and the state file
	Subscriber string        // POSTERN_PUSH_SUBSCRIBER: the VAPID contact
}

// LoadConfig reads Config via getenv. Any error is a config fault.
func LoadConfig(getenv func(string) string) (Config, error) {
	cfg := Config{
		URL:        getenv("POSTERN_WATCH_URL"),
		After:      DefaultAfter,
		Name:       orDefault(getenv("POSTERN_WATCH_NAME"), DefaultName),
		DataDir:    orDefault(getenv("POSTERN_DATA"), defaultDataDir),
		Subscriber: orDefault(getenv("POSTERN_PUSH_SUBSCRIBER"), defaultSubscriber),
	}
	if cfg.URL == "" {
		return Config{}, errors.New("POSTERN_WATCH_URL is required (the URL to check, e.g. http://desktop.mw:8787/healthz)")
	}
	if parsed, err := url.Parse(cfg.URL); err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return Config{}, fmt.Errorf("POSTERN_WATCH_URL %q is not an http(s) URL", cfg.URL)
	}
	if after := getenv("POSTERN_WATCH_AFTER"); after != "" {
		d, err := time.ParseDuration(after)
		if err != nil || d <= 0 {
			return Config{}, fmt.Errorf("POSTERN_WATCH_AFTER %q is not a positive duration (e.g. 3m)", after)
		}
		cfg.After = d
	}
	return cfg, nil
}

// State is what one run leaves for the next.
type State struct {
	// DownSince is the first failed check of the current outage; nil while up.
	DownSince *time.Time `json:"downSince,omitempty"`
	// Alerted is whether the "unreachable" alarm went out for this outage.
	Alerted bool `json:"alerted,omitempty"`
}

// Alarm is one push the watchdog sends.
type Alarm struct {
	Class string
	Title string
	Body  string
	Ts    int64 // Unix seconds
}

// Deps are the watchdog's collaborators, all replaceable in tests.
type Deps struct {
	Now func() time.Time
	// Check makes the one request: nil means the target is up.
	Check func(url string) error
	// Notify pushes an alarm to every device, reporting how many accepted it.
	Notify func(Alarm) (delivered int, err error)
	Logf   func(format string, args ...any)
}

// Run is one watchdog pass: check the target, step the state, push any
// alarm the step calls for, and save the state. A push that reaches no
// device at all is not recorded, so the next run tries it again. It returns
// an error only when the state file cannot be read or written.
func Run(cfg Config, deps Deps) error {
	path := filepath.Join(cfg.DataDir, stateFileName)
	state, err := loadState(path)
	if err != nil {
		return err
	}

	now := deps.Now().UTC()
	checkErr := deps.Check(cfg.URL)
	if checkErr != nil {
		deps.Logf("%s (%s) is down: %v", cfg.Name, cfg.URL, checkErr)
	}

	next, alarm := Step(state, checkErr == nil, now, cfg.After, cfg.Name)
	if alarm != nil {
		delivered, err := deps.Notify(*alarm)
		if err != nil {
			deps.Logf("pushing %q: %v", alarm.Title, err)
		}
		if delivered == 0 && err != nil {
			// Reached no one: leave the alarm owed, so the next run retries it.
			if checkErr == nil {
				next = state // still owes "is back"
			} else {
				next.Alerted = false // still owes "unreachable"
			}
		} else {
			deps.Logf("pushed %q (%s) to %d device(s)", alarm.Title, alarm.Body, delivered)
		}
	}

	return saveState(path, next)
}

// Step is the watchdog's state machine: given the last state and whether
// the target answered at now, the next state and the alarm to push, if any.
func Step(state State, up bool, now time.Time, after time.Duration, name string) (State, *Alarm) {
	if up {
		if state.Alerted && state.DownSince != nil {
			minutes := int(math.Round(now.Sub(*state.DownSince).Minutes()))
			return State{}, &Alarm{Class: "alarm", Title: name + " is back", Body: fmt.Sprintf("down %d min", minutes), Ts: now.Unix()}
		}
		return State{}, nil
	}

	next := state
	if next.DownSince == nil {
		since := now
		next.DownSince = &since
	}
	if next.Alerted || now.Sub(*next.DownSince) < after {
		return next, nil
	}
	next.Alerted = true
	body := "since " + next.DownSince.UTC().Format("15:04") + "Z"
	return next, &Alarm{Class: "alarm", Title: name + " unreachable", Body: body, Ts: now.Unix()}
}

// HTTPCheck returns a Check making one GET with the given timeout: up is a
// 2xx answer; anything else — an error, a timeout, another status — is down.
func HTTPCheck(timeout time.Duration) func(string) error {
	client := &http.Client{Timeout: timeout}
	return func(target string) error {
		resp, err := client.Get(target)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return fmt.Errorf("answered %d", resp.StatusCode)
		}
		return nil
	}
}

func loadState(path string) (State, error) {
	var state State
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return state, nil
	}
	if err != nil {
		return state, fmt.Errorf("reading %s: %w", path, err)
	}
	if err := json.Unmarshal(data, &state); err != nil {
		return State{}, nil // a corrupt state file is a fresh start, not a fault
	}
	return state, nil
}

// saveState writes state atomically: a temp file renamed into place.
func saveState(path string, state State) error {
	data, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("marshaling state: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("creating %s: %w", filepath.Dir(path), err)
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return fmt.Errorf("writing %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return fmt.Errorf("renaming %s into place: %w", tmp, err)
	}
	return nil
}

func orDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
