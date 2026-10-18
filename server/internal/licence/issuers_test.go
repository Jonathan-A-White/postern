package licence

import (
	"reflect"
	"strings"
	"testing"
)

// mw-cvwm1u.12: a Rule may name several issuers (his, and the site issuer's);
// a licence counts when any one of them signed its mint, and only an issuer
// that signed a mint may revoke it.

func rule2(his, site string) Rule {
	return Rule{IssuerKey: his, ExtraIssuerKeys: []string{site}}
}

func TestEitherIssuersMintCountsUnderARuleNamingBoth(t *testing.T) {
	his, site, holderA, holderB := newTestKey(t), newTestKey(t), newTestKey(t), newTestKey(t)
	reader := newSpendingReader()
	reader.add(contractMint(his, "postern", addressOf(holderA)), addressOf(his))
	reader.add(contractMint(site, "postern", addressOf(holderB)), addressOf(site))
	rule := rule2(pubHex(his), pubHex(site))

	for name, holder := range map[string]string{"his": addressOf(holderA), "the site's": addressOf(holderB)} {
		if !mustHeld(t, reader, holder, rule) {
			t.Fatalf("walk: a licence signed by %s issuer is not held", name)
		}
		if got := find(t, reader, holder, rule, nil); !reflect.DeepEqual(got.Collections, []string{"postern"}) {
			t.Fatalf("find: a licence signed by %s issuer gave %v, want [postern]", name, got.Collections)
		}
	}
}

func TestAMintSignedByNeitherIssuerIsRefusedUnderARuleNamingBoth(t *testing.T) {
	his, site, stranger, holder := newTestKey(t), newTestKey(t), newTestKey(t), newTestKey(t)
	reader := newSpendingReader()
	reader.add(contractMint(stranger, "postern", addressOf(holder)), addressOf(stranger), addressOf(holder))
	rule := rule2(pubHex(his), pubHex(site))

	if mustHeld(t, reader, addressOf(holder), rule) {
		t.Fatal("walk: held a mint neither issuer signed")
	}
	if got := find(t, reader, addressOf(holder), rule, nil); len(got.Collections) != 0 {
		t.Fatalf("find: collections %v for a mint neither issuer signed", got.Collections)
	}
}

func TestTheSiteIssuersMintIsRefusedUnderARuleNamingOnlyHis(t *testing.T) {
	his, site, holder := newTestKey(t), newTestKey(t), newTestKey(t)
	reader := newSpendingReader()
	reader.add(contractMint(site, "postern", addressOf(holder)), addressOf(site))
	rule := Rule{IssuerKey: pubHex(his)}

	if mustHeld(t, reader, addressOf(holder), rule) {
		t.Fatal("walk: held a site-issued licence with the site key not in the rule")
	}
	if got := find(t, reader, addressOf(holder), rule, nil); len(got.Collections) != 0 {
		t.Fatalf("find: collections %v with the site key not in the rule", got.Collections)
	}
}

func TestTheSiteIssuersRevokeEndsItsOwnLicence(t *testing.T) {
	his, site, holder := newTestKey(t), newTestKey(t), newTestKey(t)
	mint := contractMint(site, "postern", addressOf(holder))
	reader := newSpendingReader()
	reader.add(mint, addressOf(site))
	rule := rule2(pubHex(his), pubHex(site))
	if !mustHeld(t, reader, addressOf(holder), rule) {
		t.Fatal("walk: the site-issued licence is not held before the revoke")
	}

	reader.add(revokeTx(site, mint.txid+":0", 0xe1), addressOf(site))

	if mustHeld(t, reader, addressOf(holder), rule) {
		t.Fatal("walk: held a licence its site issuer revoked")
	}
	if got := find(t, reader, addressOf(holder), rule, []Mint{{Txid: mint.txid, Collection: "postern"}}); len(got.Collections) != 0 {
		t.Fatalf("find: collections %v for a licence its site issuer revoked", got.Collections)
	}
}

func TestOnlyTheIssuerThatSignedAMintMayRevokeIt(t *testing.T) {
	his, site, holder := newTestKey(t), newTestKey(t), newTestKey(t)
	mint := contractMint(his, "postern", addressOf(holder))
	reader := newSpendingReader()
	reader.add(mint, addressOf(his))
	// The hot site key signs a revoke of his licence: it is not his to end.
	reader.add(revokeTx(site, mint.txid+":0", 0xe1), addressOf(site))
	rule := rule2(pubHex(his), pubHex(site))

	if !mustHeld(t, reader, addressOf(holder), rule) {
		t.Fatal("walk: the site issuer revoked a licence it did not sign")
	}
	if got := find(t, reader, addressOf(holder), rule, nil); !reflect.DeepEqual(got.Collections, []string{"postern"}) {
		t.Fatalf("find: collections %v, want [postern]: the site issuer did not sign this mint", got.Collections)
	}
}

func TestExtraIssuerKeysAreLowerCasedAndAMalformedOneIsAnError(t *testing.T) {
	his, site, holder := newTestKey(t), newTestKey(t), newTestKey(t)
	reader := newFakeReader()
	reader.add(contractMint(site, "postern", addressOf(holder)), addressOf(site))
	if !mustHeld(t, reader, addressOf(holder), rule2(pubHex(his), strings.ToUpper(pubHex(site)))) {
		t.Fatal("an upper-case extra issuer key was not matched")
	}
	if _, err := Held(reader, addressOf(holder), Rule{IssuerKey: pubHex(his), ExtraIssuerKeys: []string{"02abcd"}}); err == nil {
		t.Fatal("a malformed extra issuer key was accepted")
	}
}

func TestExtraIssuerKeysAloneAreAnIssuerRule(t *testing.T) {
	site, holder, self := newTestKey(t), newTestKey(t), newTestKey(t)
	reader := newFakeReader()
	reader.add(contractMint(self, "postern", addressOf(holder)), addressOf(holder))
	if mustHeld(t, reader, addressOf(holder), Rule{ExtraIssuerKeys: []string{pubHex(site)}}) {
		t.Fatal("a self-minted licence was held though an issuer is named")
	}
}
