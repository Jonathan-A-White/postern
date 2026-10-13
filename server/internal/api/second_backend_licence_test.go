package api

import (
	"bytes"
	"encoding/hex"
	"net/http"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/auth"
	"github.com/Jonathan-A-White/postern/server/internal/config"
	"github.com/Jonathan-A-White/postern/server/internal/licence"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
	"github.com/btcsuite/btcd/btcec/v2"
)

// One licence, minted by one issuer key, counts on every backend configured
// with that issuer key, wherever it runs (docs/second-backend.md): the
// holder's phone mints once and the member's backend, a second instance with
// its own env, accepts it.

// backendFor builds a backend as main.go does from the environment env: the
// licence rule is the config's collections, its apps' collections and its
// issuer key, over the one chain.
func backendFor(t *testing.T, chain *chainFake, env map[string]string) gristServer {
	t.Helper()
	env["POSTERN_ANCHOR"] = "mt6vaAWeFxu2qC6pPs7bsqTNvv87dCwMW5"
	cfg, err := config.Load(func(k string) string { return env[k] })
	if err != nil {
		t.Fatalf("config.Load: %v", err)
	}
	collections := append([]string{}, cfg.Collections...)
	collections = append(collections, cfg.AppCollections...)
	rule := licence.Rule{Collections: collections, IssuerKey: cfg.IssuerKey}
	checker := auth.NewCachedChecker(chain, time.Minute, auth.WithRule(rule))
	s := newGristServerChecking(t, checker, WithGrist(cfg.MillKey, cfg.Apps), WithIdentity(cfg.MayorKey, cfg.Network))
	return s
}

func TestALicenceFromTheIssuerCountsOnBothBackendsAndNotOnOneWithAnotherIssuer(t *testing.T) {
	const collection = "spellforge-leaderboard-testnet"
	issuer, _ := btcec.PrivKeyFromBytes(bytes.Repeat([]byte{0x77}, 32))
	other, _ := btcec.PrivKeyFromBytes(bytes.Repeat([]byte{0x78}, 32))
	holder, _ := btcec.PrivKeyFromBytes(bytes.Repeat([]byte{0x55}, 32))
	issuerHex := hex.EncodeToString(issuer.PubKey().SerializeCompressed())
	otherHex := hex.EncodeToString(other.PubKey().SerializeCompressed())
	holderHex := hex.EncodeToString(holder.PubKey().SerializeCompressed())

	issuerAddress, _ := licence.AddressForPublicKey(issuerHex)
	holderAddress, _ := licence.AddressForPublicKey(holderHex)
	chain := &chainFake{history: map[string][]woc.HistoryEntry{}, txs: map[string]string{}}
	chain.put(fundingTx(issuer, 0xf1))
	chain.add(issuerAddress, gatedMint(issuer, collection, holderAddress))

	mill1, _ := btcec.PrivKeyFromBytes(bytes.Repeat([]byte{0x21}, 32))
	mill2, _ := btcec.PrivKeyFromBytes(bytes.Repeat([]byte{0x22}, 32))
	envFor := func(issuerKey string, mill *btcec.PrivateKey) map[string]string {
		return map[string]string{
			"POSTERN_COLLECTIONS": "postern",
			"POSTERN_APPS":        collection + "=spellforge",
			"POSTERN_ISSUER_KEY":  issuerKey,
			"POSTERN_MILL_KEY":    hex.EncodeToString(mill.PubKey().SerializeCompressed()),
		}
	}
	holders := func(s gristServer) gristServer {
		entry := s.v.Keys["stranger"]
		entry.PrivateKeyHex = hex.EncodeToString(holder.Serialize())
		entry.PublicKeyHex = holderHex
		entry.Collections = nil
		s.v.Keys["holder"] = entry
		return s
	}
	first := holders(backendFor(t, chain, envFor(issuerHex, mill1)))
	second := holders(backendFor(t, chain, envFor(issuerHex, mill2)))
	foreign := holders(backendFor(t, chain, envFor(otherHex, mill2)))

	for name, s := range map[string]gristServer{"the first backend": first, "the second backend": second} {
		resp := s.do(t, "holder", http.MethodGet, "/api/me", "")
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("%s: GET /api/me with the issuer's licence = %d, want 200", name, resp.StatusCode)
		}
	}
	resp := foreign.do(t, "holder", http.MethodGet, "/api/me", "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("a backend with another issuer key: GET /api/me = %d, want 401 (the licence is not its issuer's)", resp.StatusCode)
	}
}
