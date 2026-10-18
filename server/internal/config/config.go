// Package config reads postern's backend configuration from the
// environment.
package config

import (
	"bufio"
	"encoding/hex"
	"fmt"
	"io"
	"net/url"
	"strconv"
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
	// Peers is POSTERN_PEERS, "host=url" pairs, comma-separated: each host's
	// backend (scheme://host[:port]), host names lower-cased. A standby relays
	// its send routes to the home's entry.
	Peers map[string]string
	// PeerOrder is the keys of Peers in the order POSTERN_PEERS lists them.
	PeerOrder []string
	// RelayOnly is POSTERN_RELAY_ONLY=1: a standby that only relays the send
	// routes to whichever peer is home, and stores, polls and pushes nothing.
	RelayOnly bool
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

	// TwilioAccountSID, TwilioAuthToken and TwilioVerifySID are
	// POSTERN_TWILIO_ACCOUNT_SID, POSTERN_TWILIO_AUTH_TOKEN and
	// POSTERN_TWILIO_VERIFY_SID: the Twilio Verify service self-registration
	// sends its codes through. Registration is closed unless all three are set.
	TwilioAccountSID string
	TwilioAuthToken  string
	TwilioVerifySID  string
	// RegisterStartsPerHour and RegisterConfirmsPerHour are
	// POSTERN_REGISTER_STARTS_PER_HOUR (default 10) and
	// POSTERN_REGISTER_CONFIRMS_PER_HOUR (default 30): how many of each one IP
	// may make an hour.
	RegisterStartsPerHour   int
	RegisterConfirmsPerHour int
	// RegisterIPHeader is POSTERN_REGISTER_IP_HEADER: the header the proxy
	// sets to the caller's address (nginx: X-Real-IP), which the per-IP limits
	// read. Empty counts the connection's own address.
	RegisterIPHeader string
	// SiteIssuerKey is POSTERN_SITE_ISSUER_KEY: the site issuer's private
	// key, a testnet WIF, trimmed, which signs the Lampas licences
	// self-registration issues (cmd/postern parses it). Empty means
	// registration is licensed by hand. A Secret: it never prints.
	SiteIssuerKey Secret
}

// Secret is a value that must never reach a log: printed with any verb it
// shows only whether it is set. string(s) is the value.
type Secret string

func (s Secret) String() string {
	if s == "" {
		return "(unset)"
	}
	return "(secret)"
}

// GoString keeps %#v from printing the value too.
func (s Secret) GoString() string { return s.String() }

// TwilioConfigured reports whether registration has everything it needs from
// Twilio: all three of its names are set.
func (c Config) TwilioConfigured() bool {
	return c.TwilioAccountSID != "" && c.TwilioAuthToken != "" && c.TwilioVerifySID != ""
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

		TwilioAccountSID: strings.TrimSpace(getenv("POSTERN_TWILIO_ACCOUNT_SID")),
		TwilioAuthToken:  strings.TrimSpace(getenv("POSTERN_TWILIO_AUTH_TOKEN")),
		TwilioVerifySID:  strings.TrimSpace(getenv("POSTERN_TWILIO_VERIFY_SID")),
		RegisterIPHeader: strings.TrimSpace(getenv("POSTERN_REGISTER_IP_HEADER")),
		SiteIssuerKey:    Secret(strings.TrimSpace(getenv("POSTERN_SITE_ISSUER_KEY"))),
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
	if cfg.Peers, cfg.PeerOrder, err = peerPairs(getenv("POSTERN_PEERS")); err != nil {
		return Config{}, err
	}
	switch v := strings.TrimSpace(getenv("POSTERN_RELAY_ONLY")); v {
	case "", "0":
	case "1":
		cfg.RelayOnly = true
		if len(cfg.Peers) == 0 {
			return Config{}, fmt.Errorf("POSTERN_RELAY_ONLY=1 needs POSTERN_PEERS: a relay-only backend finds the home from its peers")
		}
	default:
		return Config{}, fmt.Errorf("POSTERN_RELAY_ONLY must be 1 or unset, not %q", v)
	}
	for i, origin := range cfg.CORSOrigins {
		if err := checkOrigin(origin); err != nil {
			return Config{}, err
		}
		cfg.CORSOrigins[i] = strings.ToLower(origin)
	}

	if cfg.RegisterStartsPerHour, err = perHour("POSTERN_REGISTER_STARTS_PER_HOUR", getenv("POSTERN_REGISTER_STARTS_PER_HOUR"), 10); err != nil {
		return Config{}, err
	}
	if cfg.RegisterConfirmsPerHour, err = perHour("POSTERN_REGISTER_CONFIRMS_PER_HOUR", getenv("POSTERN_REGISTER_CONFIRMS_PER_HOUR"), 30); err != nil {
		return Config{}, err
	}

	return cfg, nil
}

// perHour parses a per-hour limit: a whole number of 1 or more, fallback if
// unset.
func perHour(name, value string, fallback int) (int, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(value)
	if err != nil || n < 1 {
		return 0, fmt.Errorf("%s must be a whole number of 1 or more, not %q", name, value)
	}
	return n, nil
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

// peerPairs parses POSTERN_PEERS: "host=url" pairs, comma-separated, each url
// a backend's base (http or https, a host, no path). Host names are
// lower-cased and a trailing slash on the url dropped. It also answers the
// hosts in the order they were listed.
func peerPairs(value string) (map[string]string, []string, error) {
	peers := map[string]string{}
	var order []string
	for _, pair := range splitList(value) {
		host, raw, ok := strings.Cut(pair, "=")
		host, raw = strings.ToLower(strings.TrimSpace(host)), strings.TrimSpace(raw)
		if !ok || host == "" || raw == "" {
			return nil, nil, fmt.Errorf("POSTERN_PEERS: %q is not host=url", pair)
		}
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
			return nil, nil, fmt.Errorf("POSTERN_PEERS: %q is not a backend URL like http://10.88.0.2:8787", raw)
		}
		if _, seen := peers[host]; !seen {
			order = append(order, host)
		}
		peers[host] = strings.TrimSuffix(raw, "/")
	}
	return peers, order, nil
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

// ParseEnvFile reads a systemd EnvironmentFile: KEY=value lines, blank lines
// and # comments skipped, a value optionally wrapped in one pair of single or
// double quotes. A line that is not KEY=value is an error naming its number,
// never its text (a value may be a secret).
func ParseEnvFile(r io.Reader) (map[string]string, error) {
	env := map[string]string{}
	sc := bufio.NewScanner(r)
	for n := 1; sc.Scan(); n++ {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		key, value = strings.TrimSpace(key), strings.TrimSpace(value)
		if !ok || key == "" {
			return nil, fmt.Errorf("env file line %d is not KEY=value", n)
		}
		if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[len(value)-1] == value[0] {
			value = value[1 : len(value)-1]
		}
		env[key] = value
	}
	if err := sc.Err(); err != nil {
		return nil, fmt.Errorf("reading env file: %w", err)
	}
	return env, nil
}
