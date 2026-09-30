package api

import (
	"encoding/json"
	"net/http"
	"reflect"
	"testing"
)

// privateKeyOnePub is the public key of private key 1, whose testnet P2PKH
// address is the well-known mrCDrCybB6J1vRfbwM5hemdJz73FwDBC8r.
const (
	privateKeyOnePub  = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
	privateKeyOneAddr = "mrCDrCybB6J1vRfbwM5hemdJz73FwDBC8r"
)

type gotCollection struct {
	Name string `json:"name"`
	App  string `json:"app"`
}

type meCatalogue struct {
	Collections *[]gotCollection `json:"collections"`
	Issuer      *string         `json:"issuer"`
}

// meCatalogueOf decodes /api/me as the named vector key saw it.
func (s gristServer) meCatalogueOf(t *testing.T, as string) (meCatalogue, map[string]json.RawMessage) {
	t.Helper()
	resp := s.do(t, as, http.MethodGet, "/api/me", "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/me as %s: status %d", as, resp.StatusCode)
	}
	var raw map[string]json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		t.Fatalf("decoding /api/me: %v", err)
	}
	var out meCatalogue
	if c, ok := raw["collections"]; ok {
		out.Collections = new([]gotCollection)
		if err := json.Unmarshal(c, out.Collections); err != nil {
			t.Fatalf("decoding collections: %v", err)
		}
	}
	if i, ok := raw["issuer"]; ok {
		out.Issuer = new(string)
		if err := json.Unmarshal(i, out.Issuer); err != nil {
			t.Fatalf("decoding issuer: %v", err)
		}
	}
	return out, raw
}

func TestMeTellsACockpitKeyTheCollectionsAndTheIssuer(t *testing.T) {
	s := newGristServer(t, WithCatalogue([]string{"postern", "spellforge-leaderboard-testnet"}, []string{"cairn"}, privateKeyOnePub))

	got, _ := s.meCatalogueOf(t, "governor")
	want := []gotCollection{
		{Name: "postern"},
		{Name: "spellforge-leaderboard-testnet"},
		{Name: "cairn", App: "cairn"},
	}
	if got.Collections == nil || !reflect.DeepEqual(*got.Collections, want) {
		t.Fatalf("collections = %v, want %v", got.Collections, want)
	}
	if got.Issuer == nil || *got.Issuer != privateKeyOneAddr {
		t.Fatalf("issuer = %v, want %s", got.Issuer, privateKeyOneAddr)
	}
}

func TestMeOmitsTheIssuerWhenTheKeyIsNotSet(t *testing.T) {
	s := newGristServer(t, WithCatalogue([]string{"postern"}, []string{"cairn"}, ""))

	got, raw := s.meCatalogueOf(t, "governor")
	if _, present := raw["issuer"]; present {
		t.Fatalf("issuer present (%v), want it absent when POSTERN_ISSUER_KEY is unset", got.Issuer)
	}
	if got.Collections == nil || len(*got.Collections) != 2 {
		t.Fatalf("collections = %v, want postern and cairn", got.Collections)
	}
}

func TestMeTellsAnAppKeyNeitherCollectionsNorIssuer(t *testing.T) {
	s := newGristServer(t, WithCatalogue([]string{"postern"}, []string{"cairn"}, privateKeyOnePub))

	_, raw := s.meCatalogueOf(t, "cairnPhone")
	for _, field := range []string{"collections", "issuer"} {
		if _, present := raw[field]; present {
			t.Fatalf("an app key's /api/me has %q, want neither collections nor issuer", field)
		}
	}
}
