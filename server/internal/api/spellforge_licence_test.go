package api

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/auth"
	"github.com/Jonathan-A-White/postern/server/internal/licence"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
	"github.com/btcsuite/btcd/btcec/v2"
)

// A spell-forge purchaser's key holding a gated License token, through the
// real licence rule (docs/licence-token.md): the backend configured as
// main.go configures it with POSTERN_COLLECTIONS=postern and
// POSTERN_APPS=spellforge-leaderboard-testnet=spellforge.

// gatedMint is buildContractMintTransaction today, funded (fundingTx(issuer,
// 0xf1)) and signed by issuer: [0] a License stand-in, [1] a Fuel stand-in, [2] spell-forge's
// 6-push M (mw-jeswf.3: a 32-byte commitment c(0), an empty manifest, then
// {collection, holder, wrapKey, wrap}) naming holder in collection.
func gatedMint(issuer *btcec.PrivateKey, collection, holder string) string {
	payload := `{"collection":"` + collection + `","holder":"` + holder + `","wrapKey":"04` + strings.Repeat("5e", 64) + `","wrap":"01` + strings.Repeat("a7", 125) + `"}`
	m := []byte{0x00, 0x6a}
	for _, push := range [][]byte{[]byte("nftgate"), {0x02}, []byte("M"), bytes.Repeat([]byte{0xc0}, 32), {0x00}, []byte(payload)} {
		m = append(m, pushBytes(push)...)
	}
	return signedTx(issuer, 0xf1, bytes.Repeat([]byte{0x7e}, 10), bytes.Repeat([]byte{0x7c}, 10), m)
}

// newSpellforgeServer licenses a "purchaser" key through an issuer-signed
// gated mint in spellforge-leaderboard-testnet, and adds an "unlicensed"
// key with no token at all.
func newSpellforgeServer(t *testing.T) gristServer {
	t.Helper()
	const collection = "spellforge-leaderboard-testnet"
	issuer, _ := btcec.PrivKeyFromBytes(bytes.Repeat([]byte{0x77}, 32))
	purchaser, _ := btcec.PrivKeyFromBytes(bytes.Repeat([]byte{0x55}, 32))
	unlicensed, _ := btcec.PrivKeyFromBytes(bytes.Repeat([]byte{0x66}, 32))

	issuerAddress, err := licence.AddressForPublicKey(hex.EncodeToString(issuer.PubKey().SerializeCompressed()))
	if err != nil {
		t.Fatal(err)
	}
	purchaserAddress, err := licence.AddressForPublicKey(hex.EncodeToString(purchaser.PubKey().SerializeCompressed()))
	if err != nil {
		t.Fatal(err)
	}
	chain := &chainFake{history: map[string][]woc.HistoryEntry{}, txs: map[string]string{}}
	chain.put(fundingTx(issuer, 0xf1))
	chain.add(issuerAddress, gatedMint(issuer, collection, purchaserAddress))

	apps := map[string]string{collection: "spellforge"}
	cockpitCollections := []string{"postern"}
	rule := licence.Rule{
		Collections: append(append([]string{}, cockpitCollections...), collection),
		IssuerKey:   hex.EncodeToString(issuer.PubKey().SerializeCompressed()),
	}
	checker := auth.NewCachedChecker(chain, time.Minute, auth.WithRule(rule))

	s := newGristServerChecking(t, checker, WithGrist(loadGristVectors(t).Keys["mill"].PublicKeyHex, apps))
	for name, key := range map[string]*btcec.PrivateKey{"purchaser": purchaser, "unlicensed": unlicensed} {
		entry := s.v.Keys["stranger"]
		entry.PrivateKeyHex = hex.EncodeToString(key.Serialize())
		entry.PublicKeyHex = hex.EncodeToString(key.PubKey().SerializeCompressed())
		entry.Collections = nil
		s.v.Keys[name] = entry
	}
	return s
}

func TestAGatedSpellforgeTokenOpensTheGristDoor(t *testing.T) {
	s := newSpellforgeServer(t)

	me := s.me(t, "purchaser")
	if strings.Join(me.Apps, ",") != "spellforge" || strings.Join(me.Features, ",") != "grist" || me.Mayor != nil {
		t.Fatalf("/api/me = %+v, want apps [spellforge], features [grist] and no mayor", me)
	}

	resp := s.deliver(t, "grist", "purchaser", "mill")
	got := decodeDirect(t, resp)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("posting a grist to the mill: status %d (%s), want 201", resp.StatusCode, got.Error)
	}
	records, _ := s.store.Since(0)
	if len(records) != 1 || strings.Join(records[0].SignerApps, ",") != "spellforge" {
		t.Fatalf("stored %d records (%+v), want one grist with signer_apps [spellforge]", len(records), records)
	}
}

func TestAKeyWithoutTheTokenIsRefusedNoLicence(t *testing.T) {
	s := newSpellforgeServer(t)

	resp := s.do(t, "unlicensed", http.MethodGet, "/api/me", "")
	defer resp.Body.Close()
	var body struct {
		Reason string `json:"reason"`
	}
	json.NewDecoder(resp.Body).Decode(&body)
	if resp.StatusCode != http.StatusUnauthorized || body.Reason != "no_licence" {
		t.Fatalf("GET /api/me without the token: status %d reason %q, want 401 no_licence", resp.StatusCode, body.Reason)
	}
}
