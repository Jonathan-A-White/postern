// Package config reads postern's backend configuration from the
// environment.
package config

import (
	"encoding/hex"
	"fmt"
	"net/url"
	"strings"
)

const (
	defaultAddr           = "127.0.0.1:8787"
	defaultNetwork        = "testnet"
	defaultWocBase        = "https://api.whatsonchain.com/v1/bsv/test"
	defaultDataDir        = "./data"
	defaultPushSubscriber = "https://postern.allmymind.org"
	defaultCollections    = "postern,spellforge-leaderboard-testnet"
)

// Config is the backend's environment-derived configuration.
type Config struct {
	Addr            string // POSTERN_ADDR
	Network         string // POSTERN_NETWORK
	Anchor          string // POSTERN_ANCHOR — required, no default
	WocBase         string // POSTERN_WOC_BASE
	DataDir         string // POSTERN_DATA
	VAPIDPublicKey  string // POSTERN_VAPID_PUBLIC_KEY — optional, generated into DataDir if unset
	VAPIDPrivateKey string // POSTERN_VAPID_PRIVATE_KEY — optional, generated into DataDir if unset
	PushSubscriber  string // POSTERN_PUSH_SUBSCRIBER — the VAPID contact (an https URL or email)

	// ViewFile is POSTERN_VIEW_FILE: the encrypted view mw writes, served by
	// GET /api/view. Empty means no view is configured (404).
	ViewFile string
	// BeadCmd is POSTERN_BEAD_CMD: the command line GET /api/beads/{id} runs,
	// the id appended as its own argument. Empty means 501.
	BeadCmd string
	// OnMessage is POSTERN_ON_MESSAGE: a shell command run (sh -c) after
	// records are indexed. Empty means no hook.
	OnMessage string
	// HomeCmd is POSTERN_HOME_CMD: a shell command (sh -c) whose exit 0 says
	// this host is home, e.g. `mw home --check`. Empty means no standby mode.
	HomeCmd string
	// MayorKey is POSTERN_MAYOR_KEY: the Mayor's compressed public key, hex,
	// lower-cased, answered by GET /api/me. Empty if unset.
	MayorKey string
	// IssuerKey is POSTERN_ISSUER_KEY: the licence issuer's compressed public
	// key, hex, lower-cased. Empty means the licence rule has no issuer check.
	IssuerKey string
	// Collections is POSTERN_COLLECTIONS: the collections a licence mint may
	// name, trimmed, blanks dropped.
	Collections []string

	// MillKey is POSTERN_MILL_KEY: the mill's compressed public key, hex,
	// lower-cased (docs/protocol.md §19). Empty means the backend takes no
	// grist.
	MillKey string
	// Apps is POSTERN_APPS, "collection=app" pairs, comma-separated: each
	// app's licence collection and the app it opens the grist door to. A
	// collection is an app's or a cockpit's (Collections), never both.
	Apps map[string]string
	// AppCollections is the keys of Apps in the order POSTERN_APPS lists them.
	AppCollections []string
	// OnGrist is POSTERN_ON_GRIST: a shell command run (sh -c) after a grist
	// for the mill is indexed. Empty means no hook.
	OnGrist string
	// CORSOrigins is POSTERN_CORS_ORIGINS: the origins (scheme://host[:port])
	// allowed to call the backend from a browser on another origin,
	// lower-cased.
	CORSOrigins []string
}

// Load reads Config from the environment via getenv (os.LookupEnv-style
// callers should pass os.Getenv), applying defaults for everything except
// the anchor address, which has none.
func Load(getenv func(string) string) (Config, error) {
	cfg := Config{
		Addr:            orDefault(getenv("POSTERN_ADDR"), defaultAddr),
		Network:         orDefault(getenv("POSTERN_NETWORK"), defaultNetwork),
		Anchor:          getenv("POSTERN_ANCHOR"),
		WocBase:         orDefault(getenv("POSTERN_WOC_BASE"), defaultWocBase),
		DataDir:         orDefault(getenv("POSTERN_DATA"), defaultDataDir),
		VAPIDPublicKey:  getenv("POSTERN_VAPID_PUBLIC_KEY"),
		VAPIDPrivateKey: getenv("POSTERN_VAPID_PRIVATE_KEY"),
		PushSubscriber:  orDefault(getenv("POSTERN_PUSH_SUBSCRIBER"), defaultPushSubscriber),
		ViewFile:        getenv("POSTERN_VIEW_FILE"),
		BeadCmd:         strings.TrimSpace(getenv("POSTERN_BEAD_CMD")),
		OnMessage:       strings.TrimSpace(getenv("POSTERN_ON_MESSAGE")),
		HomeCmd:         strings.TrimSpace(getenv("POSTERN_HOME_CMD")),
		Collections:     splitList(orDefault(getenv("POSTERN_COLLECTIONS"), defaultCollections)),
		OnGrist:         strings.TrimSpace(getenv("POSTERN_ON_GRIST")),
		CORSOrigins:     splitList(getenv("POSTERN_CORS_ORIGINS")),
	}

	if cfg.Anchor == "" {
		return Config{}, fmt.Errorf("POSTERN_ANCHOR is required (the anchor address to poll)")
	}

	var err error
	if cfg.MayorKey, err = compressedKey("POSTERN_MAYOR_KEY", getenv("POSTERN_MAYOR_KEY")); err != nil {
		return Config{}, err
	}
	if cfg.IssuerKey, err = compressedKey("POSTERN_ISSUER_KEY", getenv("POSTERN_ISSUER_KEY")); err != nil {
		return Config{}, err
	}
	if len(cfg.Collections) == 0 {
		return Config{}, fmt.Errorf("POSTERN_COLLECTIONS names no collection")
	}
	if cfg.MillKey, err = compressedKey("POSTERN_MILL_KEY", getenv("POSTERN_MILL_KEY")); err != nil {
		return Config{}, err
	}
	if cfg.MillKey != "" && cfg.MillKey == cfg.MayorKey {
		return Config{}, fmt.Errorf("POSTERN_MILL_KEY is the Mayor's key; the mill has a key of its own (docs/protocol.md §19)")
	}
	if cfg.Apps, cfg.AppCollections, err = appPairs(getenv("POSTERN_APPS"), cfg.Collections); err != nil {
		return Config{}, err
	}
	if cfg.MillKey == "" {
		for _, half := range []struct{ name, value string }{{"POSTERN_APPS", getenv("POSTERN_APPS")}, {"POSTERN_ON_GRIST", cfg.OnGrist}} {
			if strings.TrimSpace(half.value) != "" {
				return Config{}, fmt.Errorf("%s is set but POSTERN_MILL_KEY is not; set POSTERN_MILL_KEY or unset %s (docs/protocol.md §19)", half.name, half.name)
			}
		}
	} else if len(cfg.Apps) == 0 {
		return Config{}, fmt.Errorf("POSTERN_MILL_KEY is set but POSTERN_APPS names no app; set POSTERN_APPS (docs/protocol.md §19)")
	}
	for i, origin := range cfg.CORSOrigins {
		if err := checkOrigin(origin); err != nil {
			return Config{}, err
		}
		cfg.CORSOrigins[i] = strings.ToLower(origin)
	}

	return cfg, nil
}

// appPairs parses POSTERN_APPS: "collection=app" pairs, comma-separated,
// none of whose collections may be one of cockpit. It also answers the
// collections in the order they were listed.
func appPairs(value string, cockpit []string) (map[string]string, []string, error) {
	apps := map[string]string{}
	var order []string
	for _, pair := range splitList(value) {
		collection, app, ok := strings.Cut(pair, "=")
		collection, app = strings.TrimSpace(collection), strings.TrimSpace(app)
		if !ok || collection == "" || app == "" {
			return nil, nil, fmt.Errorf("POSTERN_APPS: %q is not collection=app", pair)
		}
		for _, c := range cockpit {
			if c == collection {
				return nil, nil, fmt.Errorf("POSTERN_APPS: %q is one of POSTERN_COLLECTIONS; a collection is an app's or the cockpit's, never both", collection)
			}
		}
		if _, seen := apps[collection]; !seen {
			order = append(order, collection)
		}
		apps[collection] = app
	}
	return apps, order, nil
}

// checkOrigin accepts a browser origin: scheme://host[:port], nothing else.
func checkOrigin(origin string) error {
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return fmt.Errorf("POSTERN_CORS_ORIGINS: %q is not an origin like https://example.com", origin)
	}
	return nil
}

// compressedKey validates value, if set, as a compressed secp256k1 public
// key in hex (66 hex characters, 02 or 03 first) and returns it lower-cased.
func compressedKey(name, value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return "", nil
	}
	raw, err := hex.DecodeString(value)
	if err != nil || len(raw) != 33 || (raw[0] != 0x02 && raw[0] != 0x03) {
		return "", fmt.Errorf("%s must be a compressed public key: 66 hex characters starting 02 or 03", name)
	}
	return value, nil
}

// splitList splits a comma-separated list, trimming each entry and dropping
// blanks.
func splitList(value string) []string {
	var out []string
	for _, part := range strings.Split(value, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}

func orDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
