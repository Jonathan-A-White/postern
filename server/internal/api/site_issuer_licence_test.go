package api

import (
	"encoding/hex"
	"net/http"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/auth"
	"github.com/Jonathan-A-White/postern/server/internal/licence"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
	"github.com/btcsuite/btcd/btcec/v2"
)

// mw-cvwm1u.12: the gated routes accept a licence the site issuer signed, as
// well as one POSTERN_ISSUER_KEY signed.

func siteIssuerChain(t *testing.T, mintBy *btcec.PrivateKey, holderAddress string) (*chainFake, string) {
	t.Helper()
	chain := &chainFake{history: map[string][]woc.HistoryEntry{}, txs: map[string]string{}}
	chain.put(fundingTx(mintBy, 0xf1))
	chain.put(fundingTx(mintBy, 0xe1))
	signerAddress, _ := licence.AddressForPublicKey(hex.EncodeToString(mintBy.PubKey().SerializeCompressed()))
	mintID := chain.add(signerAddress, signedTx(mintBy, 0xf1,
		typedScript("M", `{"collection":"postern","holder":"`+holderAddress+`"}`)))
	return chain, mintID
}

func meStatusUnder(t *testing.T, chain *chainFake, rule licence.Rule, holder *btcec.PrivateKey) int {
	t.Helper()
	checker := auth.NewCachedChecker(chain, time.Minute, auth.WithRule(rule))
	server, _, _, _ := newTestServerWithChecker(t, http.NotFound, checker)
	req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/me", nil)
	signRequest(t, server, holder, req)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /api/me: %v", err)
	}
	defer resp.Body.Close()
	return resp.StatusCode
}

func TestMeAnswers200ForALicenceTheSiteIssuerSignedAnd401ForOneNeitherDid(t *testing.T) {
	his, _ := newKey(t)
	site, _ := newKey(t)
	stranger, _ := newKey(t)
	holder, holderHex := newKey(t)
	holderAddress, _ := licence.AddressForPublicKey(holderHex)
	hisHex := hex.EncodeToString(his.PubKey().SerializeCompressed())
	siteHex := hex.EncodeToString(site.PubKey().SerializeCompressed())
	both := licence.Rule{IssuerKey: hisHex, ExtraIssuerKeys: []string{siteHex}}

	siteChain, _ := siteIssuerChain(t, site, holderAddress)
	if got := meStatusUnder(t, siteChain, both, holder); got != http.StatusOK {
		t.Fatalf("a site-issued licence: status %d, want 200", got)
	}
	if got := meStatusUnder(t, siteChain, licence.Rule{IssuerKey: hisHex}, holder); got != http.StatusUnauthorized {
		t.Fatalf("a site-issued licence with the site key not in the rule: status %d, want 401", got)
	}

	hisChain, _ := siteIssuerChain(t, his, holderAddress)
	if got := meStatusUnder(t, hisChain, both, holder); got != http.StatusOK {
		t.Fatalf("his licence beside the site key: status %d, want 200", got)
	}

	strangerChain, _ := siteIssuerChain(t, stranger, holderAddress)
	if got := meStatusUnder(t, strangerChain, both, holder); got != http.StatusUnauthorized {
		t.Fatalf("a mint neither issuer signed: status %d, want 401", got)
	}
}

func TestMeAnswers401OnceTheSiteIssuerRevokedItsLicence(t *testing.T) {
	his, _ := newKey(t)
	site, _ := newKey(t)
	holder, holderHex := newKey(t)
	holderAddress, _ := licence.AddressForPublicKey(holderHex)
	siteAddress, _ := licence.AddressForPublicKey(hex.EncodeToString(site.PubKey().SerializeCompressed()))
	rule := licence.Rule{
		IssuerKey:       hex.EncodeToString(his.PubKey().SerializeCompressed()),
		ExtraIssuerKeys: []string{hex.EncodeToString(site.PubKey().SerializeCompressed())},
	}
	chain, mintID := siteIssuerChain(t, site, holderAddress)

	if got := meStatusUnder(t, chain, rule, holder); got != http.StatusOK {
		t.Fatalf("before the revoke: status %d, want 200", got)
	}
	chain.add(siteAddress, signedTx(site, 0xe1, typedScript("W", `{"kind":"revoke","origin":"`+mintID+`:0"}`)))
	if got := meStatusUnder(t, chain, rule, holder); got != http.StatusUnauthorized {
		t.Fatalf("after the site issuer revoked: status %d, want 401", got)
	}
}
