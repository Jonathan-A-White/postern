package buildinfo

import (
	"runtime/debug"
	"testing"
)

func info(settings ...debug.BuildSetting) *debug.BuildInfo {
	return &debug.BuildInfo{Settings: settings}
}

func TestCommitFrom(t *testing.T) {
	rev := "0a560d1f3c9e4b7a8d2e5f60718293a4b5c6d7e8"
	cases := []struct {
		name     string
		override string
		info     *debug.BuildInfo
		want     string
	}{
		{"short vcs revision", "", info(debug.BuildSetting{Key: "vcs.revision", Value: rev}), "0a560d1"},
		{"a short revision is kept whole", "", info(debug.BuildSetting{Key: "vcs.revision", Value: "abc"}), "abc"},
		{"ldflags override wins", "deadbee", info(debug.BuildSetting{Key: "vcs.revision", Value: rev}), "deadbee"},
		{"override without build info", "deadbee", nil, "deadbee"},
		{"no build info", "", nil, "dev"},
		{"no vcs revision", "", info(debug.BuildSetting{Key: "vcs", Value: "git"}), "dev"},
		{"empty vcs revision", "", info(debug.BuildSetting{Key: "vcs.revision", Value: ""}), "dev"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := commitFrom(c.override, c.info); got != c.want {
				t.Errorf("commitFrom = %q, want %q", got, c.want)
			}
		})
	}
}

func TestCommitIsNeverEmpty(t *testing.T) {
	if Commit() == "" {
		t.Error("Commit() is empty, want a short revision or dev")
	}
}
