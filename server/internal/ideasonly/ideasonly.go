// Package ideasonly is the backend's store of each key's Ideas only setting
// (docs/protocol.md §25): a time he is away from Postern on purpose, either
// until a moment he gave or on a weekly schedule. The setting lives in
// POSTERN_DATA so every app and the Mayor read the same one; State works out
// from it, at a given time, whether the mode is on.
package ideasonly

import (
	"errors"
	"fmt"
	"regexp"
	"time"
	// The server may have no zoneinfo on disk; a schedule's tz must still load.
	_ "time/tzdata"
)

// Who made the mode on, in Status.By.
const (
	ByUntil    = "until"
	BySchedule = "schedule"
)

// Setting is one key's Ideas only setting. Until is a Unix second (0 means
// none); Schedule is the weekly windows; Reaches says what still gets through
// while the mode is on. UpdatedAt and UpdatedBy are stamped by the server.
type Setting struct {
	Until     int64      `json:"until"`
	Schedule  *Schedule  `json:"schedule,omitempty"`
	Reaches   Reaches    `json:"reaches"`
	UpdatedAt *time.Time `json:"updatedAt,omitempty"`
	UpdatedBy string     `json:"updatedBy,omitempty"`
}

// Schedule is a weekly schedule: windows read as wall-clock time in TZ (an
// IANA zone name).
type Schedule struct {
	TZ      string   `json:"tz"`
	Windows []Window `json:"windows"`
}

// Window is one stretch of the week: on each of Days from From to To
// ("HH:MM"). A To not after From crosses midnight: the window belongs to the
// day it starts on and ends the next morning.
type Window struct {
	Days []string `json:"days"`
	From string   `json:"from"`
	To   string   `json:"to"`
}

// Reaches says whether a ring and an emergency are still pushed while the mode
// is on; an absent value is true.
type Reaches struct {
	Ring      *bool `json:"ring,omitempty"`
	Emergency *bool `json:"emergency,omitempty"`
}

// RingOn reports whether a ring still reaches him.
func (r Reaches) RingOn() bool { return r.Ring == nil || *r.Ring }

// EmergencyOn reports whether an emergency still reaches him.
func (r Reaches) EmergencyOn() bool { return r.Emergency == nil || *r.Emergency }

// Status is the computed state: whether the mode is on, the Unix second its
// nearest end falls on (0 when off) and what set it (ByUntil, BySchedule, or
// "" when off).
type Status struct {
	On    bool   `json:"on"`
	Until int64  `json:"until"`
	By    string `json:"by"`
}

var (
	days          = map[string]time.Weekday{"sun": time.Sunday, "mon": time.Monday, "tue": time.Tuesday, "wed": time.Wednesday, "thu": time.Thursday, "fri": time.Friday, "sat": time.Saturday}
	clockPat      = regexp.MustCompile(`^([01][0-9]|2[0-3]):([0-5][0-9])$`)
	lookAheadDays = 8
)

// Validate says, in one line, what is wrong with s: a negative until, a time
// zone that does not load, a day that is not mon..sun, a time that is not
// HH:MM, or a window that ends when it starts.
func (s Setting) Validate() error {
	if s.Until < 0 {
		return errors.New("until must be a Unix time in seconds, or 0 for none")
	}
	if s.Schedule == nil {
		return nil
	}
	if _, err := time.LoadLocation(s.Schedule.TZ); err != nil || s.Schedule.TZ == "" {
		return fmt.Errorf("schedule needs a time zone name such as America/Chicago, not %q", s.Schedule.TZ)
	}
	for i, w := range s.Schedule.Windows {
		n := i + 1
		if len(w.Days) == 0 {
			return fmt.Errorf("window %d names no day", n)
		}
		for _, d := range w.Days {
			if _, ok := days[d]; !ok {
				return fmt.Errorf("window %d: day %q must be one of mon tue wed thu fri sat sun", n, d)
			}
		}
		if !clockPat.MatchString(w.From) {
			return fmt.Errorf("window %d: from %q must be HH:MM", n, w.From)
		}
		if !clockPat.MatchString(w.To) {
			return fmt.Errorf("window %d: to %q must be HH:MM", n, w.To)
		}
		if w.From == w.To {
			return fmt.Errorf("window %d ends when it starts", n)
		}
	}
	return nil
}

// State works out whether the mode is on at now. When both until and a window
// hold, Until is the nearer of the two ends (and By says which); the mode
// stays on while either holds, so a change event follows at that end if the
// other still does.
func State(s Setting, now time.Time) Status {
	var st Status
	if s.Until > now.Unix() {
		st = Status{On: true, Until: s.Until, By: ByUntil}
	}
	if end, ok := windowEnd(s, now); ok && (!st.On || end.Unix() < st.Until) {
		st = Status{On: true, Until: end.Unix(), By: BySchedule}
	}
	return st
}

// NextStart is the first moment after now at which one of s's windows begins.
func NextStart(s Setting, now time.Time) (time.Time, bool) {
	loc, ws := s.zone()
	if loc == nil {
		return time.Time{}, false
	}
	local := now.In(loc)
	var best time.Time
	found := false
	for offset := 0; offset <= lookAheadDays; offset++ {
		day := local.AddDate(0, 0, offset)
		for _, w := range ws {
			if !w.onDay(day.Weekday()) {
				continue
			}
			start := w.at(day, w.From, loc)
			if start.After(now) && (!found || start.Before(best)) {
				best, found = start, true
			}
		}
		if found {
			break
		}
	}
	return best, found
}

// windowEnd is the end of the schedule stretch now falls in, joining windows
// that run back to back.
func windowEnd(s Setting, now time.Time) (time.Time, bool) {
	loc, ws := s.zone()
	if loc == nil {
		return time.Time{}, false
	}
	end, ok := coveringEnd(ws, loc, now)
	if !ok {
		return time.Time{}, false
	}
	for i := 0; i < lookAheadDays*len(ws); i++ {
		next, more := coveringEnd(ws, loc, end)
		if !more || !next.After(end) {
			break
		}
		end = next
	}
	return end, true
}

// coveringEnd is the latest end among the windows that cover t.
func coveringEnd(ws []Window, loc *time.Location, t time.Time) (time.Time, bool) {
	local := t.In(loc)
	var best time.Time
	found := false
	for offset := 0; offset >= -1; offset-- { // a window starts today, or yesterday and runs past midnight
		day := local.AddDate(0, 0, offset)
		for _, w := range ws {
			if !w.onDay(day.Weekday()) {
				continue
			}
			start, end := w.at(day, w.From, loc), w.at(day, w.To, loc)
			if !end.After(start) {
				end = w.at(day.AddDate(0, 0, 1), w.To, loc)
			}
			if !t.Before(start) && t.Before(end) && (!found || end.After(best)) {
				best, found = end, true
			}
		}
	}
	return best, found
}

// zone is the schedule's location and windows; a nil location means no usable
// schedule.
func (s Setting) zone() (*time.Location, []Window) {
	if s.Schedule == nil || len(s.Schedule.Windows) == 0 {
		return nil, nil
	}
	loc, err := time.LoadLocation(s.Schedule.TZ)
	if err != nil {
		return nil, nil
	}
	return loc, s.Schedule.Windows
}

func (w Window) onDay(d time.Weekday) bool {
	for _, name := range w.Days {
		if days[name] == d {
			return true
		}
	}
	return false
}

// at is hhmm on the calendar day of day, in loc.
func (w Window) at(day time.Time, hhmm string, loc *time.Location) time.Time {
	var h, m int
	fmt.Sscanf(hhmm, "%d:%d", &h, &m)
	return time.Date(day.Year(), day.Month(), day.Day(), h, m, 0, 0, loc)
}
