package config

import "testing"

func TestLoadDefaults(t *testing.T) {
	getenv := func(key string) string {
		if key == "POSTERN_ANCHOR" {
			return "mAnchorAddress"
		}
		return ""
	}

	cfg, err := Load(getenv)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Addr != "127.0.0.1:8787" {
		t.Fatalf("Addr = %q, want 127.0.0.1:8787", cfg.Addr)
	}
	if cfg.Network != "testnet" {
		t.Fatalf("Network = %q, want testnet", cfg.Network)
	}
	if cfg.WocBase != "https://api.whatsonchain.com/v1/bsv/test" {
		t.Fatalf("WocBase = %q, want the testnet WhatsOnChain base", cfg.WocBase)
	}
	if cfg.DataDir != "./data" {
		t.Fatalf("DataDir = %q, want ./data", cfg.DataDir)
	}
	if cfg.VAPIDPublicKey != "" || cfg.VAPIDPrivateKey != "" {
		t.Fatalf("VAPID keys = %q/%q, want both empty by default", cfg.VAPIDPublicKey, cfg.VAPIDPrivateKey)
	}
	if cfg.PushSubscriber != "https://postern.allmymind.org" {
		t.Fatalf("PushSubscriber = %q, want the default subscriber URL", cfg.PushSubscriber)
	}
}

func TestLoadOverridesFromEnv(t *testing.T) {
	env := map[string]string{
		"POSTERN_ADDR":              "0.0.0.0:9000",
		"POSTERN_NETWORK":           "mainnet",
		"POSTERN_ANCHOR":            "mAnchorAddress",
		"POSTERN_WOC_BASE":          "https://example.test/api",
		"POSTERN_DATA":              "/var/lib/postern",
		"POSTERN_VAPID_PUBLIC_KEY":  "pub-key",
		"POSTERN_VAPID_PRIVATE_KEY": "priv-key",
		"POSTERN_PUSH_SUBSCRIBER":   "mailto:governor@example.com",
	}
	getenv := func(key string) string { return env[key] }

	cfg, err := Load(getenv)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Addr != "0.0.0.0:9000" {
		t.Fatalf("Addr = %q", cfg.Addr)
	}
	if cfg.Network != "mainnet" {
		t.Fatalf("Network = %q", cfg.Network)
	}
	if cfg.Anchor != "mAnchorAddress" {
		t.Fatalf("Anchor = %q", cfg.Anchor)
	}
	if cfg.WocBase != "https://example.test/api" {
		t.Fatalf("WocBase = %q", cfg.WocBase)
	}
	if cfg.DataDir != "/var/lib/postern" {
		t.Fatalf("DataDir = %q", cfg.DataDir)
	}
	if cfg.VAPIDPublicKey != "pub-key" || cfg.VAPIDPrivateKey != "priv-key" {
		t.Fatalf("VAPID keys = %q/%q", cfg.VAPIDPublicKey, cfg.VAPIDPrivateKey)
	}
	if cfg.PushSubscriber != "mailto:governor@example.com" {
		t.Fatalf("PushSubscriber = %q", cfg.PushSubscriber)
	}
}

func TestLoadRequiresAnchor(t *testing.T) {
	getenv := func(key string) string { return "" }

	if _, err := Load(getenv); err == nil {
		t.Fatal("expected Load to fail without POSTERN_ANCHOR set")
	}
}
