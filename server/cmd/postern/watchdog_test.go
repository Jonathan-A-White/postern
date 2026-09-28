package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/Jonathan-A-White/postern/server/internal/push"
)

func envOf(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func TestWatchdogWithoutAURLIsAConfigFault(t *testing.T) {
	if code := runWatchdog(envOf(nil), t.Logf); code == 0 {
		t.Fatal("exit code 0 with no POSTERN_WATCH_URL, want non-zero")
	}
}

func TestWatchdogWithoutPushKeysIsAConfigFault(t *testing.T) {
	env := envOf(map[string]string{"POSTERN_WATCH_URL": "http://127.0.0.1:1/healthz", "POSTERN_DATA": t.TempDir()})
	if code := runWatchdog(env, t.Logf); code == 0 {
		t.Fatal("exit code 0 with no postern-vapid.json, want non-zero")
	}
}

func TestWatchdogExitsZeroUpOrDown(t *testing.T) {
	dataDir := t.TempDir()
	if _, err := push.LoadOrGenerateVAPIDKeys(dataDir, "", ""); err != nil {
		t.Fatalf("generating VAPID keys: %v", err)
	}
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) }))
	defer up.Close()
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusBadGateway) }))
	defer down.Close()

	for _, target := range []string{up.URL, down.URL} {
		env := envOf(map[string]string{"POSTERN_WATCH_URL": target + "/healthz", "POSTERN_DATA": dataDir, "POSTERN_WATCH_AFTER": "1ns"})
		if code := runWatchdog(env, t.Logf); code != 0 {
			t.Fatalf("exit code %d checking %s, want 0", code, target)
		}
	}
	if _, err := os.Stat(filepath.Join(dataDir, "watchdog-state.json")); err != nil {
		t.Fatalf("state file: %v", err)
	}
}
