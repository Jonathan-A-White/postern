package poller

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/chain"
)

// failingReader is a chain.Reader whose history read fails while err is set.
type failingReader struct {
	err     error
	history []chain.HistoryEntry
}

func (f *failingReader) GetHistory(string) ([]chain.HistoryEntry, error) { return f.history, f.err }
func (f *failingReader) GetTransactionHex(string) (string, error)        { return "", errors.New("no tx") }

type logLines struct {
	mu    sync.Mutex
	lines []string
}

func (l *logLines) logf(format string, args ...any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.lines = append(l.lines, fmt.Sprintf(format, args...))
}

func (l *logLines) all() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.lines...)
}

type fakeClock struct{ now time.Time }

func (c *fakeClock) Now() time.Time { return c.now }

// Run used to throw PollOnce's error away: for six days nothing in the
// journal said the poller was failing.
func TestAFailingPollIsLoggedAndShownInStatus(t *testing.T) {
	reader := &failingReader{err: &chain.HistoryTooLongError{Address: "mAnchor", Pages: 200}}
	clock := &fakeClock{now: time.Date(2026, 11, 4, 17, 0, 0, 0, time.UTC)}
	var log logLines
	p := New(reader, openStore(t), "mAnchor", WithLogf(log.logf), WithClock(clock.Now))

	p.poll()

	lines := log.all()
	if len(lines) != 1 || !strings.Contains(lines[0], "poll failed") || !strings.Contains(lines[0], "runs past 200 pages") {
		t.Fatalf("log = %q, want one 'poll failed' line carrying the error", lines)
	}
	st := p.Status()
	if st.OK || !strings.Contains(st.LastError, "runs past 200 pages") || !st.LastErrorAt.Equal(clock.now) || !st.FailingSince.Equal(clock.now) {
		t.Fatalf("status = %+v, want the error, when it came and since when", st)
	}
	if !st.LastGoodPoll.IsZero() {
		t.Fatalf("LastGoodPoll = %v, want none yet", st.LastGoodPoll)
	}
}

func TestAGoodPollClearsTheErrorAndStampsTheTime(t *testing.T) {
	reader := &failingReader{err: errors.New("WhatsOnChain said 503")}
	clock := &fakeClock{now: time.Date(2026, 11, 4, 17, 0, 0, 0, time.UTC)}
	var log logLines
	p := New(reader, openStore(t), "mAnchor", WithLogf(log.logf), WithClock(clock.Now))
	p.poll()

	reader.err = nil
	clock.now = clock.now.Add(5 * time.Second)
	p.poll()

	st := p.Status()
	if !st.OK || st.LastError != "" || !st.LastGoodPoll.Equal(clock.now) || !st.FailingSince.IsZero() {
		t.Fatalf("status = %+v, want ok, no error, last good poll now", st)
	}
	if lines := log.all(); len(lines) != 2 || !strings.Contains(lines[1], "poll recovered") {
		t.Fatalf("log = %q, want the failure, then one 'poll recovered' line", lines)
	}
}

// Polling every 5 s, a failure that goes on must not write a line every tick,
// and the alarm after 10 minutes must be said once, however long it goes on.
func TestALongFailureLogsOnceAndAlarmsOnceAfterTenMinutes(t *testing.T) {
	reader := &failingReader{err: errors.New("WhatsOnChain said 503")}
	clock := &fakeClock{now: time.Date(2026, 11, 4, 17, 0, 0, 0, time.UTC)}
	var log logLines
	p := New(reader, openStore(t), "mAnchor", WithLogf(log.logf), WithClock(clock.Now))

	for i := 0; i < 9*12; i++ { // nine minutes at 5 s
		p.poll()
		clock.now = clock.now.Add(5 * time.Second)
	}
	if lines := log.all(); len(lines) != 1 {
		t.Fatalf("after 9 minutes of failing, log = %q, want one line", lines)
	}
	if p.Status().Alarm {
		t.Fatalf("alarm raised before 10 minutes")
	}

	for i := 0; i < 3*12; i++ { // up to twelve minutes
		p.poll()
		clock.now = clock.now.Add(5 * time.Second)
	}
	alarms := 0
	for _, line := range log.all() {
		if strings.Contains(line, "poll alarm") {
			alarms++
		}
	}
	if alarms != 1 || !p.Status().Alarm {
		t.Fatalf("alarm lines = %d (log %q), status alarm = %v, want exactly one line and the alarm on", alarms, log.all(), p.Status().Alarm)
	}
	if len(log.all()) > 3 {
		t.Fatalf("log = %q, want the first failure and the alarm, not a line a tick", log.all())
	}
}

// A different error is news, and is logged.
func TestAChangedErrorIsLoggedAgain(t *testing.T) {
	reader := &failingReader{err: errors.New("WhatsOnChain said 503")}
	var log logLines
	p := New(reader, openStore(t), "mAnchor", WithLogf(log.logf))
	p.poll()
	p.poll()
	reader.err = errors.New("WhatsOnChain said 429")
	p.poll()
	if len(log.all()) != 2 {
		t.Fatalf("log = %q, want two lines (the first error once, then the new one)", log.all())
	}
}
