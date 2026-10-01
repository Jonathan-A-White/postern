// Package buildinfo says which commit the running binary was built from, so a
// backend swap is verified from GET /healthz instead of a cmp of the binary.
package buildinfo

import (
	"runtime/debug"
)

// commit is an optional build-time override:
//
//	go build -ldflags "-X github.com/Jonathan-A-White/postern/server/internal/buildinfo.commit=<rev>"
//
// Without it the Go toolchain's own vcs.revision stamp is used, so
// `go build -o {out} ./cmd/postern` needs no flag.
var commit string

const (
	shortLen   = 7
	unknownRev = "dev"
)

// Commit is the short revision the binary was built from: the -ldflags
// override if one was given, else the build's vcs.revision, else "dev" (a
// `go run`, a test binary, or a build outside a git checkout).
func Commit() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		info = nil
	}
	return commitFrom(commit, info)
}

func commitFrom(override string, info *debug.BuildInfo) string {
	rev := override
	if rev == "" && info != nil {
		for _, s := range info.Settings {
			if s.Key == "vcs.revision" {
				rev = s.Value
			}
		}
	}
	if rev == "" {
		return unknownRev
	}
	if len(rev) > shortLen {
		rev = rev[:shortLen]
	}
	return rev
}
