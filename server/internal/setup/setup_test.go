package setup

import (
	"bufio"
	"bytes"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Jonathan-A-White/postern/server/internal/config"
	"github.com/btcsuite/btcd/btcec/v2"
)

const issuerKey = "039d1abaec9f5715a15c7628244170951e0f85e87f68ca5393d3f9fc3fa23a69c8"

// recorder is a systemctl double that remembers the arguments of each call.
type recorder struct{ calls [][]string }

func (r *recorder) run(args ...string) error {
	r.calls = append(r.calls, args)
	return nil
}

func options(home string) Options {
	return Options{Home: home, Addr: "10.88.0.2:8788", Issuer: issuerKey, Binary: "/opt/bin/postern"}
}

// readEnvFile reads an EnvironmentFile: KEY=value lines, # comments.
func readEnvFile(t *testing.T, path string) map[string]string {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("opening env file: %v", err)
	}
	defer f.Close()
	env := map[string]string{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			t.Fatalf("env line %q is not KEY=value", line)
		}
		env[k] = strings.Trim(v, `"`)
	}
	return env
}

func TestSetupWritesTheEnvTheKeysAndTheUnitAndStartsIt(t *testing.T) {
	home := t.TempDir()
	sys := &recorder{}
	var out bytes.Buffer

	res, err := Run(options(home), Deps{Systemctl: sys.run, Out: &out})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}

	envPath := filepath.Join(home, ".config", "postern", "env")
	env := readEnvFile(t, envPath)
	cfg, err := config.Load(func(k string) string { return env[k] })
	if err != nil {
		t.Fatalf("config.Load on the written env: %v", err)
	}
	if cfg.Addr != "10.88.0.2:8788" || cfg.IssuerKey != issuerKey {
		t.Fatalf("addr/issuer = %q/%q, want what was given", cfg.Addr, cfg.IssuerKey)
	}
	if want := filepath.Join(home, ".local", "state", "postern"); cfg.DataDir != want {
		t.Fatalf("POSTERN_DATA = %q, want %q", cfg.DataDir, want)
	}
	if cfg.MayorKey == "" || cfg.MillKey == "" || cfg.MayorKey == cfg.MillKey {
		t.Fatalf("mayor/mill = %q/%q, want two different keys", cfg.MayorKey, cfg.MillKey)
	}
	if res.MayorKey != cfg.MayorKey || res.MillKey != cfg.MillKey {
		t.Fatalf("result keys %q/%q differ from the env's %q/%q", res.MayorKey, res.MillKey, cfg.MayorKey, cfg.MillKey)
	}
	if !strings.Contains(out.String(), cfg.MayorKey) {
		t.Fatalf("output %q does not print the mayor key's public half", out.String())
	}
	if strings.Contains(out.String(), "POSTERN_MILL_KEY") {
		t.Fatalf("output %q should not dump the env", out.String())
	}

	info, err := os.Stat(envPath)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("env file mode = %v (%v), want 0600", info.Mode().Perm(), err)
	}
	if info, err := os.Stat(cfg.DataDir); err != nil || !info.IsDir() {
		t.Fatalf("data dir %s was not made: %v", cfg.DataDir, err)
	}

	// The key files are mw's WIF files, and hold the private half of the keys the env names.
	for file, pub := range map[string]string{"postern.key": cfg.MayorKey, "mill.key": cfg.MillKey} {
		path := filepath.Join(home, ".config", "mw", file)
		info, err := os.Stat(path)
		if err != nil || info.Mode().Perm() != 0o600 {
			t.Fatalf("%s mode = %v (%v), want 0600", file, info.Mode().Perm(), err)
		}
		raw, _ := os.ReadFile(path)
		priv, err := ParseWIF(strings.TrimSpace(string(raw)))
		if err != nil {
			t.Fatalf("%s is not a WIF key: %v", file, err)
		}
		if got := hex.EncodeToString(priv.PubKey().SerializeCompressed()); got != pub {
			t.Fatalf("%s holds the key for %s, want %s", file, got, pub)
		}
	}

	unit, err := os.ReadFile(filepath.Join(home, ".config", "systemd", "user", "postern-backend.service"))
	if err != nil {
		t.Fatalf("unit not written: %v", err)
	}
	for _, want := range []string{"ExecStart=/opt/bin/postern", "EnvironmentFile=" + envPath, "WantedBy=default.target"} {
		if !strings.Contains(string(unit), want) {
			t.Fatalf("unit lacks %q:\n%s", want, unit)
		}
	}

	got := make([]string, len(sys.calls))
	for i, c := range sys.calls {
		got[i] = strings.Join(c, " ")
	}
	want := []string{"--user daemon-reload", "--user enable --now postern-backend.service"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("systemctl calls = %v, want %v", got, want)
	}
}

func TestSetupRefusesASecondRunAndChangesNothing(t *testing.T) {
	home := t.TempDir()
	sys := &recorder{}
	if _, err := Run(options(home), Deps{Systemctl: sys.run, Out: &bytes.Buffer{}}); err != nil {
		t.Fatalf("first Run: %v", err)
	}
	envPath := filepath.Join(home, ".config", "postern", "env")
	before, _ := os.ReadFile(envPath)
	calls := len(sys.calls)

	_, err := Run(options(home), Deps{Systemctl: sys.run, Out: &bytes.Buffer{}})
	if err == nil || !strings.Contains(err.Error(), envPath) {
		t.Fatalf("second Run error = %v, want a refusal naming %s", err, envPath)
	}
	after, _ := os.ReadFile(envPath)
	if !bytes.Equal(before, after) {
		t.Fatalf("the second run rewrote the env file")
	}
	if len(sys.calls) != calls {
		t.Fatalf("the second run called systemctl again: %v", sys.calls[calls:])
	}
}

func TestSetupRefusesWhenAnyOneFileIsAlreadyThereAndWritesNone(t *testing.T) {
	for _, existing := range [][]string{
		{".config", "systemd", "user", "postern-backend.service"},
		{".config", "mw", "postern.key"},
		{".config", "mw", "mill.key"},
	} {
		home := t.TempDir()
		path := filepath.Join(append([]string{home}, existing...)...)
		os.MkdirAll(filepath.Dir(path), 0o700)
		os.WriteFile(path, []byte("keep me\n"), 0o600)
		sys := &recorder{}

		if _, err := Run(options(home), Deps{Systemctl: sys.run, Out: &bytes.Buffer{}}); err == nil {
			t.Fatalf("Run with %s present succeeded, want a refusal", path)
		}
		if _, err := os.Stat(filepath.Join(home, ".config", "postern", "env")); !os.IsNotExist(err) {
			t.Fatalf("Run with %s present still wrote the env file", path)
		}
		if raw, _ := os.ReadFile(path); string(raw) != "keep me\n" {
			t.Fatalf("%s was overwritten", path)
		}
		if len(sys.calls) != 0 {
			t.Fatalf("systemctl called despite the refusal: %v", sys.calls)
		}
	}
}

func TestSetupRejectsABadIssuerOrAddressBeforeWritingAnything(t *testing.T) {
	for name, mutate := range map[string]func(*Options){
		"issuer not a key":    func(o *Options) { o.Issuer = "nope" },
		"issuer missing":      func(o *Options) { o.Issuer = "" },
		"addr without a port": func(o *Options) { o.Addr = "10.88.0.2" },
		"addr missing":        func(o *Options) { o.Addr = "" },
		"apps not pairs":      func(o *Options) { o.Apps = "cairn" },
	} {
		home := t.TempDir()
		opts := options(home)
		mutate(&opts)
		sys := &recorder{}
		if _, err := Run(opts, Deps{Systemctl: sys.run, Out: &bytes.Buffer{}}); err == nil {
			t.Fatalf("%s: Run succeeded, want an error", name)
		}
		if _, err := os.Stat(filepath.Join(home, ".config")); !os.IsNotExist(err) {
			t.Fatalf("%s: wrote files before refusing", name)
		}
		if len(sys.calls) != 0 {
			t.Fatalf("%s: systemctl called", name)
		}
	}
}

func TestGenerateKeyMakesAFreshWIFThatRoundTrips(t *testing.T) {
	a, b := NewKey(), NewKey()
	if a.Public() == b.Public() {
		t.Fatalf("two generated keys share a public half")
	}
	back, err := ParseWIF(a.WIF())
	if err != nil {
		t.Fatalf("ParseWIF(%q): %v", a.WIF(), err)
	}
	if hex.EncodeToString(back.PubKey().SerializeCompressed()) != a.Public() {
		t.Fatalf("WIF did not round-trip")
	}
	// A known vector: private key 1, testnet, compressed.
	priv, _ := btcec.PrivKeyFromBytes(append(make([]byte, 31), 1))
	if got := wifOf(priv); got != "cMahea7zqjxrtgAbB7LSGbcQUr1uX1ojuat9jZodMN87JcbXMTcA" {
		t.Fatalf("WIF of key 1 = %s, want the known testnet vector", got)
	}
}
