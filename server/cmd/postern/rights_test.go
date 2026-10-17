package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/Jonathan-A-White/postern/server/internal/api"
)

const (
	rightsMayorKey = "02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	rightsMillKey  = "03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	rightsVAPID    = "vapid-private-SECRET-value"
)

func writeRightsEnv(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "postern.env")
	env := "POSTERN_ANCHOR=1SomeAnchorAddress\n" +
		"POSTERN_MAYOR_KEY=" + rightsMayorKey + "\n" +
		"POSTERN_MILL_KEY=" + rightsMillKey + "\n" +
		"POSTERN_VAPID_PRIVATE_KEY=" + rightsVAPID + "\n" +
		"POSTERN_COLLECTIONS=postern,second\n" +
		"POSTERN_APPS=cairn=cairn\n"
	if err := os.WriteFile(path, []byte(env), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

type rightsOut struct {
	Collections []api.CollectionRights `json:"collections"`
}

func TestRightsJSONPrintsTheMapTheGateIsBuiltFrom(t *testing.T) {
	envPath := writeRightsEnv(t)
	before, _ := os.ReadDir(filepath.Dir(envPath))

	var out, errOut bytes.Buffer
	if code := runRights([]string{"--json", "--env-file", envPath}, os.Getenv, &out, &errOut); code != 0 {
		t.Fatalf("exit %d: %s", code, errOut.String())
	}
	var got rightsOut
	if err := json.Unmarshal(out.Bytes(), &got); err != nil {
		t.Fatalf("output is not JSON: %v\n%s", err, out.String())
	}
	want := api.LicenceMap([]string{"postern", "second"}, []string{"cairn"}, map[string]string{"cairn": "cairn"})
	if !reflect.DeepEqual(got.Collections, want) {
		t.Fatalf("printed %v, want %v", got.Collections, want)
	}
	kinds := []string{}
	for _, c := range got.Collections {
		kinds = append(kinds, c.Collection+":"+c.Kind+":"+c.App)
	}
	if !reflect.DeepEqual(kinds, []string{"postern:cockpit:", "second:cockpit:", "cairn:app:cairn"}) {
		t.Fatalf("collections = %v", kinds)
	}

	for _, secret := range []string{rightsMayorKey, rightsMillKey, rightsVAPID, "1SomeAnchorAddress"} {
		if strings.Contains(out.String(), secret) || strings.Contains(errOut.String(), secret) {
			t.Fatalf("the output carries %q from the env file", secret)
		}
	}
	after, _ := os.ReadDir(filepath.Dir(envPath))
	if len(after) != len(before) {
		t.Fatalf("rights wrote files: %v -> %v", before, after)
	}
}

func TestRightsReadsTheProcessEnvironmentWithoutAnEnvFile(t *testing.T) {
	env := map[string]string{"POSTERN_ANCHOR": "x"}
	var out, errOut bytes.Buffer
	if code := runRights([]string{"--json"}, func(k string) string { return env[k] }, &out, &errOut); code != 0 {
		t.Fatalf("exit %d: %s", code, errOut.String())
	}
	var got rightsOut
	if err := json.Unmarshal(out.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Collections) != 2 || got.Collections[0].Collection != "postern" || got.Collections[1].Collection != "spellforge-leaderboard-testnet" {
		t.Fatalf("defaults not used: %v", got.Collections)
	}
}

func TestRightsRefusesAnEnvFileItCannotLoad(t *testing.T) {
	var out, errOut bytes.Buffer
	if code := runRights([]string{"--json", "--env-file", filepath.Join(t.TempDir(), "none.env")}, os.Getenv, &out, &errOut); code == 0 || out.Len() != 0 {
		t.Fatalf("exit %d with output %q, want a failure that prints no map", code, out.String())
	}
}
