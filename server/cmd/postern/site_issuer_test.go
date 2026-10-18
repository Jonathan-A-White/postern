package main

import (
	"encoding/hex"
	"strings"
	"testing"

	"github.com/Jonathan-A-White/postern/server/internal/config"
	"github.com/Jonathan-A-White/postern/server/internal/setup"
)

func siteIssuerConfig(t *testing.T, siteKey, issuerKey string) config.Config {
	t.Helper()
	cfg, err := config.Load(func(key string) string {
		return map[string]string{
			"POSTERN_ANCHOR":          "mt6vaAWeFxu2qC6pPs7bsqTNvv87dCwMW5",
			"POSTERN_DATA":            t.TempDir(),
			"POSTERN_WOC_BASE":        "http://unused.invalid",
			"POSTERN_HOME_CMD":        "exit 0",
			"POSTERN_SITE_ISSUER_KEY": siteKey,
			"POSTERN_ISSUER_KEY":      issuerKey,
		}[key]
	})
	if err != nil {
		t.Fatalf("config.Load: %v", err)
	}
	return cfg
}

// AC5 (mw-cvwm1u.3): the backend starts issuing with the site key, names its
// public key and address so it can be funded, and never logs the key.
func TestTheSiteIssuerStartsAndTheLogNamesOnlyItsPublicHalf(t *testing.T) {
	logged := captureLog(t)
	k := setup.NewKey()
	cfg := siteIssuerConfig(t, k.WIF(), "")
	issuer, err := newSiteIssuer(cfg, newChain(cfg))
	if err != nil || issuer == nil {
		t.Fatalf("newSiteIssuer = %v, %v", issuer, err)
	}
	if issuer.PublicKey() != k.Public() {
		t.Fatalf("issuer key %s, want %s", issuer.PublicKey(), k.Public())
	}
	app, err := newApp(cfg)
	if err != nil {
		t.Fatalf("newApp: %v", err)
	}
	app.close()
	priv, _ := setup.ParseWIF(k.WIF())
	out := logged()
	if !strings.Contains(out, "site issuer: "+k.Public()) {
		t.Fatalf("the log does not name the site issuer's public key:\n%s", out)
	}
	for _, secret := range []string{k.WIF(), hex.EncodeToString(priv.Serialize())} {
		if strings.Contains(out, secret) {
			t.Fatalf("the log carries the site key:\n%s", out)
		}
	}
}

func TestWithoutTheSiteIssuerKeyTheBackendStartsAndSaysRegistrationIsByHand(t *testing.T) {
	logged := captureLog(t)
	cfg := siteIssuerConfig(t, "", "")
	issuer, err := newSiteIssuer(cfg, newChain(cfg))
	if err != nil || issuer != nil {
		t.Fatalf("newSiteIssuer = %v, %v; want none and no error", issuer, err)
	}
	if !strings.Contains(logged(), "POSTERN_SITE_ISSUER_KEY is not set") {
		t.Fatalf("no line says the site issuer is off:\n%s", logged())
	}
	app, err := newApp(cfg)
	if err != nil {
		t.Fatalf("newApp: %v", err)
	}
	app.close()
}

func TestABadSiteIssuerKeyIsRefusedWithoutBeingShown(t *testing.T) {
	const garbage = "cVeryMuchASecretThatIsNotAWIFxxxxxxxxxxxxxxxxxxxxxxx"
	cfg := siteIssuerConfig(t, garbage, "")
	if _, err := newSiteIssuer(cfg, newChain(cfg)); err == nil || strings.Contains(err.Error(), garbage) || !strings.Contains(err.Error(), "POSTERN_SITE_ISSUER_KEY") {
		t.Fatalf("err = %v, want one naming POSTERN_SITE_ISSUER_KEY and not its value", err)
	}

	k := setup.NewKey()
	cfg = siteIssuerConfig(t, k.WIF(), k.Public())
	if _, err := newSiteIssuer(cfg, newChain(cfg)); err == nil || !strings.Contains(err.Error(), "POSTERN_ISSUER_KEY") || strings.Contains(err.Error(), k.WIF()) {
		t.Fatalf("err = %v, want a refusal of the Governor's own issuer key", err)
	}
}
