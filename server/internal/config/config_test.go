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

func TestLoadV2Defaults(t *testing.T) {
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
	if cfg.ViewFile != "" || cfg.BeadCmd != "" || cfg.OnMessage != "" {
		t.Fatalf("ViewFile/BeadCmd/OnMessage = %q/%q/%q, want all empty by default", cfg.ViewFile, cfg.BeadCmd, cfg.OnMessage)
	}
	if cfg.MayorKey != "" || cfg.IssuerKey != "" {
		t.Fatalf("MayorKey/IssuerKey = %q/%q, want both empty by default", cfg.MayorKey, cfg.IssuerKey)
	}
	want := []string{"postern", "spellforge-leaderboard-testnet"}
	if len(cfg.Collections) != len(want) || cfg.Collections[0] != want[0] || cfg.Collections[1] != want[1] {
		t.Fatalf("Collections = %q, want %q", cfg.Collections, want)
	}
}

const (
	testMayorKey  = "029cbf013d04ca50ba852816c2802b06ca5ed37b44be9597fc0f95360e209afa97"
	testIssuerKey = "039D1ABAEC9F5715A15C7628244170951E0F85E87F68CA5393D3F9FC3FA23A69C8"
)

func TestLoadV2OverridesFromEnv(t *testing.T) {
	env := map[string]string{
		"POSTERN_ANCHOR":      "mAnchorAddress",
		"POSTERN_VIEW_FILE":   "/var/lib/mw/postern-view.txt",
		"POSTERN_BEAD_CMD":    "mw postern bead",
		"POSTERN_ON_MESSAGE":  "mw postern inbox --apply",
		"POSTERN_MAYOR_KEY":   testMayorKey,
		"POSTERN_ISSUER_KEY":  testIssuerKey,
		"POSTERN_COLLECTIONS": " postern , ,other-collection ",
	}
	cfg, err := Load(func(key string) string { return env[key] })
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.ViewFile != "/var/lib/mw/postern-view.txt" {
		t.Fatalf("ViewFile = %q", cfg.ViewFile)
	}
	if cfg.BeadCmd != "mw postern bead" {
		t.Fatalf("BeadCmd = %q", cfg.BeadCmd)
	}
	if cfg.OnMessage != "mw postern inbox --apply" {
		t.Fatalf("OnMessage = %q", cfg.OnMessage)
	}
	if cfg.MayorKey != testMayorKey {
		t.Fatalf("MayorKey = %q", cfg.MayorKey)
	}
	if cfg.IssuerKey != "039d1abaec9f5715a15c7628244170951e0f85e87f68ca5393d3f9fc3fa23a69c8" {
		t.Fatalf("IssuerKey = %q, want it lower-cased", cfg.IssuerKey)
	}
	if len(cfg.Collections) != 2 || cfg.Collections[0] != "postern" || cfg.Collections[1] != "other-collection" {
		t.Fatalf("Collections = %q, want [postern other-collection] (trimmed, blanks dropped)", cfg.Collections)
	}
}

func TestLoadRejectsMalformedKeys(t *testing.T) {
	for _, tc := range []struct{ name, key, value string }{
		{"mayor too short", "POSTERN_MAYOR_KEY", "02abcd"},
		{"mayor not hex", "POSTERN_MAYOR_KEY", "02" + "zz" + testMayorKey[4:]},
		{"mayor not compressed", "POSTERN_MAYOR_KEY", "04" + testMayorKey[2:]},
		{"issuer too long", "POSTERN_ISSUER_KEY", testMayorKey + "00"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			env := map[string]string{"POSTERN_ANCHOR": "mAnchorAddress", tc.key: tc.value}
			if _, err := Load(func(key string) string { return env[key] }); err == nil {
				t.Fatalf("Load accepted %s=%q, want an error", tc.key, tc.value)
			}
		})
	}
}

func TestLoadRejectsAnEmptyCollectionList(t *testing.T) {
	env := map[string]string{"POSTERN_ANCHOR": "mAnchorAddress", "POSTERN_COLLECTIONS": " , "}
	if _, err := Load(func(key string) string { return env[key] }); err == nil {
		t.Fatal("Load accepted a POSTERN_COLLECTIONS naming no collection, want an error")
	}
}

// gristEnv is an environment with the anchor set and the given overrides.
func gristEnv(overrides map[string]string) func(string) string {
	return func(key string) string {
		if key == "POSTERN_ANCHOR" {
			return "mAnchorAddress"
		}
		return overrides[key]
	}
}

func TestLoadGristDefaultsToNoMillNoAppsNoCORS(t *testing.T) {
	cfg, err := Load(gristEnv(nil))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.MillKey != "" || len(cfg.Apps) != 0 || cfg.OnGrist != "" || len(cfg.CORSOrigins) != 0 {
		t.Fatalf("grist config = %q %v %q %v, want all empty", cfg.MillKey, cfg.Apps, cfg.OnGrist, cfg.CORSOrigins)
	}
}

func TestLoadGristFromEnv(t *testing.T) {
	cfg, err := Load(gristEnv(map[string]string{
		"POSTERN_MILL_KEY":     "034F355BDCB7CC0AF728EF3CCEB9615D90684BB5B2CA5F859AB0F0B704075871AA",
		"POSTERN_APPS":         " cairn=cairn , spellforge-grist=spellforge ",
		"POSTERN_ON_GRIST":     " mw grist grind ",
		"POSTERN_CORS_ORIGINS": "https://jonathan-a-white.github.io, http://localhost:5173",
	}))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.MillKey != "034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa" {
		t.Fatalf("MillKey = %q, want it lower-cased", cfg.MillKey)
	}
	if len(cfg.Apps) != 2 || cfg.Apps["cairn"] != "cairn" || cfg.Apps["spellforge-grist"] != "spellforge" {
		t.Fatalf("Apps = %v", cfg.Apps)
	}
	if cfg.OnGrist != "mw grist grind" {
		t.Fatalf("OnGrist = %q", cfg.OnGrist)
	}
	if len(cfg.CORSOrigins) != 2 || cfg.CORSOrigins[1] != "http://localhost:5173" {
		t.Fatalf("CORSOrigins = %v", cfg.CORSOrigins)
	}
}

func TestLoadRejectsBadGristConfig(t *testing.T) {
	for name, env := range map[string]map[string]string{
		"a malformed mill key":                  {"POSTERN_MILL_KEY": "not-a-key"},
		"an app pair without an app":            {"POSTERN_APPS": "cairn="},
		"an app pair without an equals":         {"POSTERN_APPS": "cairn"},
		"an app collection that is a cockpit's": {"POSTERN_APPS": "postern=postern"},
		"an origin with a path":                 {"POSTERN_CORS_ORIGINS": "https://example.com/app"},
		"an origin with no scheme":              {"POSTERN_CORS_ORIGINS": "example.com"},
	} {
		if _, err := Load(gristEnv(env)); err == nil {
			t.Fatalf("%s: Load succeeded, want an error", name)
		}
	}
}
