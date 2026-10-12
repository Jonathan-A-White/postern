package ideasonly

import (
	"strings"
	"testing"
	"time"
)

func chicago(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation("America/Chicago")
	if err != nil {
		t.Fatalf("LoadLocation: %v", err)
	}
	return loc
}

func at(loc *time.Location, y int, m time.Month, d, h, min int) time.Time {
	return time.Date(y, m, d, h, min, 0, 0, loc)
}

func sundayWindow(from, to string) Setting {
	return Setting{Schedule: &Schedule{TZ: "America/Chicago", Windows: []Window{{Days: []string{"sun"}, From: from, To: to}}}}
}

// 2026-10-11 is a Sunday.

func TestStateIsOffWithNothingSet(t *testing.T) {
	if got := State(Setting{}, time.Now()); got != (Status{}) {
		t.Fatalf("State = %+v, want off", got)
	}
}

func TestStateIsOnUntilAFutureUntil(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	got := State(Setting{Until: now.Unix() + 3600}, now)
	if want := (Status{On: true, Until: now.Unix() + 3600, By: ByUntil}); got != want {
		t.Fatalf("State = %+v, want %+v", got, want)
	}
}

func TestStateIsOffOnceUntilHasPassed(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	for _, until := range []int64{now.Unix() - 1, now.Unix()} {
		if got := State(Setting{Until: until}, now); got.On {
			t.Fatalf("until %d: State = %+v, want off", until-now.Unix(), got)
		}
	}
}

func TestStateIsOnInASundayWindowInChicagoUntilItsEnd(t *testing.T) {
	loc := chicago(t)
	got := State(sundayWindow("09:00", "21:00"), at(loc, 2026, time.October, 11, 14, 0))
	want := Status{On: true, Until: at(loc, 2026, time.October, 11, 21, 0).Unix(), By: BySchedule}
	if got != want {
		t.Fatalf("State = %+v, want %+v", got, want)
	}
}

func TestStateIsOffOutsideTheWindowAndOnOtherDays(t *testing.T) {
	loc := chicago(t)
	s := sundayWindow("09:00", "21:00")
	for _, now := range []time.Time{
		at(loc, 2026, time.October, 11, 8, 59), // Sunday before
		at(loc, 2026, time.October, 11, 21, 0), // the end is exclusive
		at(loc, 2026, time.October, 12, 14, 0), // Monday
		at(loc, 2026, time.October, 10, 14, 0), // Saturday
	} {
		if got := State(s, now); got.On {
			t.Fatalf("at %v: State = %+v, want off", now, got)
		}
	}
}

func TestStateReadsTheWindowInTheSettingsZoneNotTheServers(t *testing.T) {
	loc := chicago(t)
	// 14:00 Sunday Chicago (CDT) is 19:00 UTC.
	now := at(loc, 2026, time.October, 11, 14, 0).UTC()
	if got := State(sundayWindow("09:00", "21:00"), now); !got.On {
		t.Fatalf("State = %+v, want on", got)
	}
}

func TestStateIsOnPastMidnightInAWindowThatCrossesIt(t *testing.T) {
	loc := chicago(t)
	s := sundayWindow("21:00", "07:00")
	got := State(s, at(loc, 2026, time.October, 12, 0, 30)) // Monday 00:30
	want := Status{On: true, Until: at(loc, 2026, time.October, 12, 7, 0).Unix(), By: BySchedule}
	if got != want {
		t.Fatalf("Monday 00:30: State = %+v, want %+v", got, want)
	}
	got = State(s, at(loc, 2026, time.October, 11, 22, 0)) // Sunday 22:00, before midnight
	want = Status{On: true, Until: at(loc, 2026, time.October, 12, 7, 0).Unix(), By: BySchedule}
	if got != want {
		t.Fatalf("Sunday 22:00: State = %+v, want %+v", got, want)
	}
	if got := State(s, at(loc, 2026, time.October, 12, 7, 0)); got.On {
		t.Fatalf("Monday 07:00: State = %+v, want off", got)
	}
	// Monday 22:00 is not Sunday's window.
	if got := State(s, at(loc, 2026, time.October, 12, 22, 0)); got.On {
		t.Fatalf("Monday 22:00: State = %+v, want off", got)
	}
}

func TestStateIsTheNearerOfUntilAndAWindowsEnd(t *testing.T) {
	loc := chicago(t)
	now := at(loc, 2026, time.October, 11, 14, 0)
	end := at(loc, 2026, time.October, 11, 21, 0).Unix()

	s := sundayWindow("09:00", "21:00")
	s.Until = end + 7200
	if got, want := State(s, now), (Status{On: true, Until: end, By: BySchedule}); got != want {
		t.Fatalf("window nearer: State = %+v, want %+v", got, want)
	}
	s.Until = end - 1800
	if got, want := State(s, now), (Status{On: true, Until: end - 1800, By: ByUntil}); got != want {
		t.Fatalf("until nearer: State = %+v, want %+v", got, want)
	}
}

func TestStateRunsBackToBackWindowsTogether(t *testing.T) {
	loc := chicago(t)
	s := Setting{Schedule: &Schedule{TZ: "America/Chicago", Windows: []Window{
		{Days: []string{"sun"}, From: "09:00", To: "12:00"},
		{Days: []string{"sun"}, From: "12:00", To: "15:00"},
	}}}
	got := State(s, at(loc, 2026, time.October, 11, 10, 0))
	if want := at(loc, 2026, time.October, 11, 15, 0).Unix(); got.Until != want {
		t.Fatalf("Until = %v, want the end of the second window %v", got.Until, want)
	}
}

func TestNextStartFindsTheNextWindowAfterNow(t *testing.T) {
	loc := chicago(t)
	s := sundayWindow("09:00", "21:00")
	got, ok := NextStart(s, at(loc, 2026, time.October, 12, 14, 0)) // Monday
	if want := at(loc, 2026, time.October, 18, 9, 0); !ok || !got.Equal(want) {
		t.Fatalf("NextStart = %v, %v, want %v", got, ok, want)
	}
	if _, ok := NextStart(Setting{}, time.Now()); ok {
		t.Fatal("NextStart of an empty setting should find none")
	}
}

func TestValidateAcceptsAGoodSettingAndNamesWhatIsWrongWithABadOne(t *testing.T) {
	good := func() Setting {
		return Setting{Until: 1_800_000_000, Schedule: &Schedule{TZ: "America/Chicago", Windows: []Window{{Days: []string{"sat", "sun"}, From: "21:00", To: "07:00"}}}}
	}
	if err := good().Validate(); err != nil {
		t.Fatalf("a good setting: %v", err)
	}
	for _, tc := range []struct {
		name   string
		mutate func(*Setting)
		want   string
	}{
		{"bad tz", func(s *Setting) { s.Schedule.TZ = "Mars/Olympus" }, "time zone"},
		{"no tz", func(s *Setting) { s.Schedule.TZ = "" }, "time zone"},
		{"bad day", func(s *Setting) { s.Schedule.Windows[0].Days = []string{"funday"} }, "day"},
		{"no days", func(s *Setting) { s.Schedule.Windows[0].Days = nil }, "day"},
		{"bad from", func(s *Setting) { s.Schedule.Windows[0].From = "25:00" }, "from"},
		{"bad to", func(s *Setting) { s.Schedule.Windows[0].To = "7am" }, "to"},
		{"empty window", func(s *Setting) { s.Schedule.Windows[0].To = s.Schedule.Windows[0].From }, "ends when it starts"},
		{"negative until", func(s *Setting) { s.Until = -5 }, "until"},
	} {
		s := good()
		tc.mutate(&s)
		err := s.Validate()
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: err = %v, want one naming %q", tc.name, err, tc.want)
		}
	}
}
