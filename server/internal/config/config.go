// Package config reads postern's backend configuration from the
// environment.
package config

import "fmt"

const (
	defaultAddr    = "127.0.0.1:8787"
	defaultNetwork = "testnet"
	defaultWocBase = "https://api.whatsonchain.com/v1/bsv/test"
	defaultDataDir = "./data"
)

// Config is the backend's environment-derived configuration.
type Config struct {
	Addr    string // POSTERN_ADDR
	Network string // POSTERN_NETWORK
	Anchor  string // POSTERN_ANCHOR — required, no default
	WocBase string // POSTERN_WOC_BASE
	DataDir string // POSTERN_DATA
}

// Load reads Config from the environment via getenv (os.LookupEnv-style
// callers should pass os.Getenv), applying defaults for everything except
// the anchor address, which has none.
func Load(getenv func(string) string) (Config, error) {
	cfg := Config{
		Addr:    orDefault(getenv("POSTERN_ADDR"), defaultAddr),
		Network: orDefault(getenv("POSTERN_NETWORK"), defaultNetwork),
		Anchor:  getenv("POSTERN_ANCHOR"),
		WocBase: orDefault(getenv("POSTERN_WOC_BASE"), defaultWocBase),
		DataDir: orDefault(getenv("POSTERN_DATA"), defaultDataDir),
	}

	if cfg.Anchor == "" {
		return Config{}, fmt.Errorf("POSTERN_ANCHOR is required (the anchor address to poll)")
	}

	return cfg, nil
}

func orDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
