package api

import (
	"encoding/json"
	"net/http"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"testing"
)

var routeParam = regexp.MustCompile(`\{[a-z]+\}`)

// admittedRoutes is every route in the table that a key holding only
// collection is let through to, found by asking the running gate: a route
// refused with reason "forbidden" is not opened, anything else (the handler's
// own answer, even an error) is.
func admittedRoutes(t *testing.T, keyName, collection string) []string {
	t.Helper()
	v := loadGristVectors(t)
	_, pub := v.key(t, keyName)
	s := newGristServerChecking(t, collectionsChecker{pub: {collection}})
	var opened []string
	for _, route := range Routes() {
		method, pattern, _ := strings.Cut(route, " ")
		path := routeParam.ReplaceAllString(pattern, pub)
		resp := s.do(t, keyName, method, path, "")
		var body struct {
			Reason string `json:"reason"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&body)
		resp.Body.Close()
		if resp.StatusCode == http.StatusUnauthorized {
			t.Fatalf("%s as %s: status 401 (%s), the key holds a licence", route, keyName, body.Reason)
		}
		if resp.StatusCode == http.StatusForbidden && body.Reason == reasonForbidden {
			continue
		}
		opened = append(opened, route)
	}
	sort.Strings(opened)
	return opened
}

func mapEntry(t *testing.T, m []CollectionRights, collection string) CollectionRights {
	t.Helper()
	for _, e := range m {
		if e.Collection == collection {
			return e
		}
	}
	t.Fatalf("the licence map has no %q: %v", collection, m)
	return CollectionRights{}
}

func TestLicenceMapRoutesAreWhatTheGateAdmits(t *testing.T) {
	apps := map[string]string{"cairn": "cairn"}
	m := LicenceMap([]string{"postern", "spellforge-leaderboard-testnet"}, []string{"cairn"}, apps)

	for _, tc := range []struct {
		key, collection, kind, app string
	}{
		{"governor", "postern", "cockpit", ""},
		{"cairnPhone", "cairn", "app", "cairn"},
	} {
		entry := mapEntry(t, m, tc.collection)
		if entry.Kind != tc.kind || entry.App != tc.app {
			t.Fatalf("%s maps to %s %q, want %s %q", tc.collection, entry.Kind, entry.App, tc.kind, tc.app)
		}
		want := admittedRoutes(t, tc.key, tc.collection)
		got := append([]string(nil), entry.Routes...)
		sort.Strings(got)
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("%s: the map says a key opens\n  %v\nthe gate admits\n  %v", tc.collection, got, want)
		}
		if len(got) == 0 {
			t.Fatalf("%s opens no route", tc.collection)
		}
	}
	// the two kinds differ, so the comparison above is not vacuous
	if reflect.DeepEqual(mapEntry(t, m, "postern").Routes, mapEntry(t, m, "cairn").Routes) {
		t.Fatal("a cockpit collection and an app collection open the same routes")
	}
}

func TestLicenceMapListsEveryCollectionTheBackendLoads(t *testing.T) {
	m := LicenceMap([]string{"a", "b"}, []string{"c", "d"}, map[string]string{"c": "cc", "d": "dd"})
	var got []string
	for _, e := range m {
		got = append(got, e.Collection+"="+e.Kind+":"+e.App)
	}
	want := []string{"a=cockpit:", "b=cockpit:", "c=app:cc", "d=app:dd"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("map = %v, want %v", got, want)
	}
}
