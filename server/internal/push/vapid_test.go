package push

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadOrGenerateVAPIDKeysGeneratesAndPersists(t *testing.T) {
	dir := t.TempDir()

	keys, err := LoadOrGenerateVAPIDKeys(dir, "", "")
	if err != nil {
		t.Fatalf("LoadOrGenerateVAPIDKeys: %v", err)
	}
	if keys.PublicKey == "" || keys.PrivateKey == "" {
		t.Fatalf("keys = %+v, want both keys set", keys)
	}

	path := filepath.Join(dir, "postern-vapid.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading %s: %v", path, err)
	}
	var persisted VAPIDKeys
	if err := json.Unmarshal(data, &persisted); err != nil {
		t.Fatalf("unmarshaling %s: %v", path, err)
	}
	if persisted != keys {
		t.Fatalf("persisted = %+v, want %+v", persisted, keys)
	}
}

func TestLoadOrGenerateVAPIDKeysReloadsExisting(t *testing.T) {
	dir := t.TempDir()

	first, err := LoadOrGenerateVAPIDKeys(dir, "", "")
	if err != nil {
		t.Fatalf("first LoadOrGenerateVAPIDKeys: %v", err)
	}

	second, err := LoadOrGenerateVAPIDKeys(dir, "", "")
	if err != nil {
		t.Fatalf("second LoadOrGenerateVAPIDKeys: %v", err)
	}

	if first != second {
		t.Fatalf("second call generated new keys: first = %+v, second = %+v", first, second)
	}
}

func TestLoadOrGenerateVAPIDKeysPrefersEnv(t *testing.T) {
	dir := t.TempDir()

	keys, err := LoadOrGenerateVAPIDKeys(dir, "env-public", "env-private")
	if err != nil {
		t.Fatalf("LoadOrGenerateVAPIDKeys: %v", err)
	}
	if keys.PublicKey != "env-public" || keys.PrivateKey != "env-private" {
		t.Fatalf("keys = %+v, want the env-provided keys", keys)
	}

	if _, err := os.Stat(filepath.Join(dir, "postern-vapid.json")); !os.IsNotExist(err) {
		t.Fatalf("expected no file written when keys came from env, stat err = %v", err)
	}
}

func TestLoadVAPIDKeysReadsWithoutGenerating(t *testing.T) {
	dir := t.TempDir()
	if _, err := LoadVAPIDKeys(dir, "", ""); err == nil {
		t.Fatal("LoadVAPIDKeys with no key file = nil error, want an error (it must never generate)")
	}
	if _, err := os.Stat(filepath.Join(dir, vapidFileName)); !os.IsNotExist(err) {
		t.Fatalf("LoadVAPIDKeys wrote %s", vapidFileName)
	}

	generated, err := LoadOrGenerateVAPIDKeys(dir, "", "")
	if err != nil {
		t.Fatalf("LoadOrGenerateVAPIDKeys: %v", err)
	}
	loaded, err := LoadVAPIDKeys(dir, "", "")
	if err != nil {
		t.Fatalf("LoadVAPIDKeys: %v", err)
	}
	if loaded != generated {
		t.Fatalf("loaded %+v, want the generated %+v", loaded, generated)
	}

	fromEnv, err := LoadVAPIDKeys(t.TempDir(), "pub", "priv")
	if err != nil || fromEnv.PublicKey != "pub" || fromEnv.PrivateKey != "priv" {
		t.Fatalf("LoadVAPIDKeys from env = %+v, %v", fromEnv, err)
	}
}
