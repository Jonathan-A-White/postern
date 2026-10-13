package main

import (
	"bufio"
	"bytes"
	"encoding/hex"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Jonathan-A-White/postern/server/internal/config"
	"github.com/Jonathan-A-White/postern/server/internal/setup"
)

const testIssuer = "039d1abaec9f5715a15c7628244170951e0f85e87f68ca5393d3f9fc3fa23a69c8"

func freeAddr(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().String()
}

// envFromFile reads an EnvironmentFile as systemd does: KEY=value lines.
func envFromFile(t *testing.T, path string) map[string]string {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	env := map[string]string{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if k, v, ok := strings.Cut(line, "="); ok && !strings.HasPrefix(line, "#") {
			env[k] = v
		}
	}
	return env
}

// setupFor runs `postern setup` for a fresh user home on addr and answers the
// env file it wrote.
func setupFor(t *testing.T, addr string) (home string, env map[string]string) {
	t.Helper()
	home = t.TempDir()
	var out, errOut bytes.Buffer
	deps := setup.Deps{Systemctl: func(...string) error { return nil }, Out: &out}
	code := runSetup([]string{"--addr", addr, "--issuer", testIssuer}, home, "/opt/bin/postern", deps, &errOut)
	if code != 0 {
		t.Fatalf("postern setup exited %d: %s", code, errOut.String())
	}
	return home, envFromFile(t, filepath.Join(home, ".config", "postern", "env"))
}

// serve starts the backend the env describes on its own address, the way
// systemd would, and answers its base URL.
func serve(t *testing.T, env map[string]string) config.Config {
	t.Helper()
	env["POSTERN_WOC_BASE"] = "http://unused.invalid"
	cfg, err := config.Load(func(k string) string { return env[k] })
	if err != nil {
		t.Fatalf("config.Load: %v", err)
	}
	app, err := newApp(cfg)
	if err != nil {
		t.Fatalf("newApp: %v", err)
	}
	t.Cleanup(app.close)
	l, err := net.Listen("tcp", cfg.Addr)
	if err != nil {
		t.Fatalf("listening on %s: %v", cfg.Addr, err)
	}
	srv := &http.Server{Handler: app.handler}
	go srv.Serve(l)
	t.Cleanup(func() { srv.Close() })
	return cfg
}

func TestTwoBackendsFromTwoEnvFilesRunSideBySideSharingNothing(t *testing.T) {
	addrA, addrB := freeAddr(t), freeAddr(t)
	_, envA := setupFor(t, addrA)
	_, envB := setupFor(t, addrB)

	a, b := serve(t, envA), serve(t, envB)

	for _, cfg := range []config.Config{a, b} {
		resp, err := http.Get("http://" + cfg.Addr + "/healthz")
		if err != nil {
			t.Fatalf("GET /healthz on %s: %v", cfg.Addr, err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK || !strings.Contains(string(body), `"ok":true`) {
			t.Fatalf("%s /healthz = %d %s, want 200 ok", cfg.Addr, resp.StatusCode, body)
		}
	}

	if a.Addr == b.Addr {
		t.Fatalf("both backends listen on %s", a.Addr)
	}
	if a.MayorKey == b.MayorKey || a.MillKey == b.MillKey {
		t.Fatalf("the two backends share a key: mayor %s/%s mill %s/%s", a.MayorKey, b.MayorKey, a.MillKey, b.MillKey)
	}
	if a.IssuerKey != testIssuer || b.IssuerKey != testIssuer {
		t.Fatalf("issuer keys %q/%q, want the one given to both", a.IssuerKey, b.IssuerKey)
	}
	if a.DataDir == b.DataDir {
		t.Fatalf("both backends keep their data in %s", a.DataDir)
	}
	// Each instance made its own nonce and push keys in its own data dir.
	for _, name := range []string{"postern-nonce.key", "postern-vapid.json"} {
		ra, errA := os.ReadFile(filepath.Join(a.DataDir, name))
		rb, errB := os.ReadFile(filepath.Join(b.DataDir, name))
		if errA != nil || errB != nil {
			t.Fatalf("%s missing from a data dir: %v / %v", name, errA, errB)
		}
		if bytes.Equal(ra, rb) {
			t.Fatalf("both backends hold the same %s", name)
		}
	}
}

func TestSetupCommandRefusesASecondRunAndSaysWhy(t *testing.T) {
	home := t.TempDir()
	deps := setup.Deps{Systemctl: func(...string) error { return nil }, Out: io.Discard}
	args := []string{"--addr", "127.0.0.1:8788", "--issuer", testIssuer}
	if code := runSetup(args, home, "/opt/bin/postern", deps, io.Discard); code != 0 {
		t.Fatalf("first run exited %d", code)
	}
	var errOut bytes.Buffer
	if code := runSetup(args, home, "/opt/bin/postern", deps, &errOut); code == 0 || !strings.Contains(errOut.String(), "already there") {
		t.Fatalf("second run exited %d with %q, want non-zero and a refusal", code, errOut.String())
	}
}

func TestSetupCommandNeedsAddrAndIssuer(t *testing.T) {
	deps := setup.Deps{Systemctl: func(...string) error { return nil }, Out: io.Discard}
	for _, args := range [][]string{{}, {"--addr", "127.0.0.1:8788"}, {"--issuer", testIssuer}, {"--bogus"}} {
		var errOut bytes.Buffer
		if code := runSetup(args, t.TempDir(), "/opt/bin/postern", deps, &errOut); code == 0 || errOut.Len() == 0 {
			t.Fatalf("setup %v exited %d with %q, want a usage error", args, code, errOut.String())
		}
	}
}

func TestKeygenWritesAWIFFileAndPrintsOnlyThePublicHalf(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", "k.key")
	var out, errOut bytes.Buffer
	if code := runKeygen([]string{"--out", path}, &out, &errOut); code != 0 {
		t.Fatalf("keygen exited %d: %s", code, errOut.String())
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	priv, err := setup.ParseWIF(strings.TrimSpace(string(raw)))
	if err != nil {
		t.Fatalf("key file is not WIF: %v", err)
	}
	pub := hex.EncodeToString(priv.PubKey().SerializeCompressed())
	if strings.TrimSpace(out.String()) != pub {
		t.Fatalf("keygen printed %q, want just the public key %s", out.String(), pub)
	}
	if info, _ := os.Stat(path); info.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %v, want 0600", info.Mode().Perm())
	}
	if code := runKeygen([]string{"--out", path}, io.Discard, &errOut); code == 0 {
		t.Fatalf("keygen overwrote an existing key")
	}
	if code := runKeygen(nil, io.Discard, io.Discard); code == 0 {
		t.Fatalf("keygen without --out succeeded")
	}
}
