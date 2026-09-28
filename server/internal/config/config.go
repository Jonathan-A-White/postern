// Package config reads postern's backend configuration from the
// environment.
package config

import (
	"encoding/hex"
	"fmt"
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
	// MayorKey is POSTERN_MAYOR_KEY: the Mayor's compressed public key, hex,
	// lower-cased, answered by GET /api/me. Empty if unset.
	MayorKey string
	// IssuerKey is POSTERN_ISSUER_KEY: the licence issuer's compressed public
	// key, hex, lower-cased. Empty means the licence rule has no issuer check.
	IssuerKey string
	// Collections is POSTERN_COLLECTIONS: the collections a licence mint may
	// name, trimmed, blanks dropped.
	Collections []string
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
		Collections:     splitList(orDefault(getenv("POSTERN_COLLECTIONS"), defaultCollections)),
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

	return cfg, nil
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
