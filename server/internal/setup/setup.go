package setup

import (
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"

	"github.com/Jonathan-A-White/postern/server/internal/config"
)

const (
	// UnitName is the user unit setup installs: the same name the first
	// backend's unit has, under its own user's systemd.
	UnitName = "postern-backend.service"

	// DefaultAnchor is the message channel's anchor address (docs/protocol.md
	// §3): every backend on the host polls the same one.
	DefaultAnchor = "mt6vaAWeFxu2qC6pPs7bsqTNvv87dCwMW5"

	// DefaultApps is the grist doors a new backend opens: the mill key is
	// configuration, and a mill key needs at least one (docs/protocol.md §19).
	DefaultApps = "cairn=cairn"
)

// Options are what `postern setup` is told.
type Options struct {
	Home   string // the user's home directory
	Addr   string // POSTERN_ADDR: host:port this instance listens on
	Issuer string // POSTERN_ISSUER_KEY: the licence issuer's compressed public key, hex
	Apps   string // POSTERN_APPS; DefaultApps when empty
	Anchor string // POSTERN_ANCHOR; DefaultAnchor when empty
	Binary string // the postern executable the unit runs
}

// Deps are the outside world setup touches.
type Deps struct {
	Systemctl func(args ...string) error // runs `systemctl <args>`
	Out       io.Writer
}

// Result is what a run made.
type Result struct {
	MayorKey string // the Mayor's public key, hex
	MillKey  string // the mill's public key, hex
	EnvFile  string
	UnitFile string
	DataDir  string
}

// paths are everything setup writes, all under one home.
type paths struct {
	env, unit, data, mayorKey, millKey string
}

func pathsFor(home string) paths {
	return paths{
		env:      filepath.Join(home, ".config", "postern", "env"),
		unit:     filepath.Join(home, ".config", "systemd", "user", UnitName),
		data:     filepath.Join(home, ".local", "state", "postern"),
		mayorKey: filepath.Join(home, ".config", "mw", "postern.key"),
		millKey:  filepath.Join(home, ".config", "mw", "mill.key"),
	}
}

// Run is `postern setup`: it checks everything first, writes nothing if
// anything is wrong or already there, then makes the keys, the env file, the
// data directory and the user unit, and starts the unit.
func Run(opts Options, deps Deps) (Result, error) {
	if opts.Home == "" {
		return Result{}, fmt.Errorf("no home directory to set up in")
	}
	if opts.Apps == "" {
		opts.Apps = DefaultApps
	}
	if opts.Anchor == "" {
		opts.Anchor = DefaultAnchor
	}
	if opts.Binary == "" {
		return Result{}, fmt.Errorf("no postern executable to run")
	}
	if _, port, err := net.SplitHostPort(opts.Addr); err != nil || port == "" {
		return Result{}, fmt.Errorf("--addr %q is not host:port, e.g. 10.88.0.2:8788", opts.Addr)
	}
	if opts.Issuer == "" {
		return Result{}, fmt.Errorf("--issuer is required: the public key that signs the licences this backend accepts")
	}

	p := pathsFor(opts.Home)
	mayor, mill := NewKey(), NewKey()
	envText := renderEnv(opts, p, mayor, mill)

	// The env file is loaded exactly as the backend will load it, so a bad
	// issuer key or app list is refused here, not at the first start.
	env := parseEnv(envText)
	if _, err := config.Load(func(k string) string { return env[k] }); err != nil {
		return Result{}, fmt.Errorf("the configuration setup would write is no good: %w", err)
	}

	for _, f := range []string{p.env, p.unit, p.mayorKey, p.millKey} {
		if _, err := os.Lstat(f); err == nil {
			return Result{}, fmt.Errorf("%s is already there: postern setup runs once per user and will not overwrite it (the way back is in docs/second-backend.md)", f)
		} else if !os.IsNotExist(err) {
			return Result{}, fmt.Errorf("checking %s: %w", f, err)
		}
	}

	for _, w := range []struct {
		path, text string
		dirMode    os.FileMode
		mode       os.FileMode
	}{
		{p.mayorKey, mayor.WIF() + "\n", 0o700, 0o600},
		{p.millKey, mill.WIF() + "\n", 0o700, 0o600},
		{p.env, envText, 0o700, 0o600},
		{p.unit, renderUnit(opts.Binary, p.env), 0o755, 0o644},
	} {
		if err := writeNew(w.path, w.text, w.dirMode, w.mode); err != nil {
			return Result{}, err
		}
	}
	if err := os.MkdirAll(p.data, 0o700); err != nil {
		return Result{}, fmt.Errorf("making the data directory %s: %w", p.data, err)
	}

	for _, args := range [][]string{{"--user", "daemon-reload"}, {"--user", "enable", "--now", UnitName}} {
		if err := deps.Systemctl(args...); err != nil {
			return Result{}, fmt.Errorf("systemctl %s: %w (the files are written; finish with systemctl --user enable --now %s)", strings.Join(args, " "), err, UnitName)
		}
	}

	res := Result{MayorKey: mayor.Public(), MillKey: mill.Public(), EnvFile: p.env, UnitFile: p.unit, DataDir: p.data}
	fmt.Fprintf(deps.Out, `postern backend set up and started for this user.

  listening on        %s
  Mayor key (public)  %s
  mill key (public)   %s
  issuer key          %s
  env file            %s
  unit                %s
  data                %s
  Mayor key file      %s  (mw's postern_key_file; mw postern key show prints the same public key)
  mill key file       %s

Put the Mayor key (public) in this user's mw config and in the cockpit as the Mayor.

The way back (stops the backend, removes everything this run made):
  systemctl --user disable --now %s
  rm %s %s %s %s %s
  rm -r %s
`, opts.Addr, res.MayorKey, res.MillKey, opts.Issuer, p.env, p.unit, p.data, p.mayorKey, p.millKey,
		UnitName, p.env, p.unit, p.mayorKey, p.millKey, filepath.Join(opts.Home, ".config", "postern"), p.data)
	return res, nil
}

// writeNew makes path's directory and writes text to path, which must not
// exist.
func writeNew(path, text string, dirMode, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), dirMode); err != nil {
		return fmt.Errorf("making %s: %w", filepath.Dir(path), err)
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return fmt.Errorf("writing %s: %w", path, err)
	}
	if _, err := f.WriteString(text); err != nil {
		f.Close()
		return fmt.Errorf("writing %s: %w", path, err)
	}
	return f.Close()
}

// renderEnv is the EnvironmentFile: only what differs per instance. Paths are
// absolute because systemd does not expand %h in an EnvironmentFile.
func renderEnv(opts Options, p paths, mayor, mill Key) string {
	lines := [][2]string{
		{"POSTERN_ADDR", opts.Addr},
		{"POSTERN_ANCHOR", opts.Anchor},
		{"POSTERN_DATA", p.data},
		{"POSTERN_MAYOR_KEY", mayor.Public()},
		{"POSTERN_MILL_KEY", mill.Public()},
		{"POSTERN_ISSUER_KEY", opts.Issuer},
		{"POSTERN_COLLECTIONS", "postern"},
		{"POSTERN_APPS", opts.Apps},
	}
	var b strings.Builder
	b.WriteString("# Written by `postern setup`. One backend per Linux user: see docs/second-backend.md.\n")
	for _, kv := range lines {
		fmt.Fprintf(&b, "%s=%s\n", kv[0], kv[1])
	}
	return b.String()
}

// parseEnv reads the KEY=value lines setup writes.
func parseEnv(text string) map[string]string {
	env := map[string]string{}
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if k, v, ok := strings.Cut(line, "="); ok {
			env[k] = v
		}
	}
	return env
}

func renderUnit(binary, envFile string) string {
	return fmt.Sprintf(`[Unit]
Description=Postern Go backend (this user's own instance, docs/second-backend.md)

[Service]
ExecStart=%s
EnvironmentFile=%s
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`, binary, envFile)
}
