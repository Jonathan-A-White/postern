package api

import "strings"

// routeTable is the gate: every /api route that needs a signed, licensed key
// and the kinds of key it admits (docs/protocol.md §19). NewHandler registers
// exactly these routes behind requireLicence, and LicenceMap (postern rights)
// reads the same table, so what a key opens is written in one place.
var routeTable = []struct {
	pattern string
	who     access
}{
	{"GET /api/messages", everyKey},
	{"POST /api/messages", everyKey},
	{"GET /api/me", everyKey},
	{"GET /api/view", cockpitKeys},
	{"GET /api/events", cockpitKeys | mayorKey | appKeys},
	{"GET /api/presence", cockpitKeys},
	{"GET /api/prompts", everyKey | mayorKey},
	{"GET /api/prompts/{name}", everyKey | mayorKey},
	{"PUT /api/prompts/{name}", cockpitKeys},
	{"DELETE /api/prompts/{name}", cockpitKeys},
	{"GET /api/ideas-only/{pubkey}", cockpitKeys | mayorKey},
	{"PUT /api/ideas-only/{pubkey}", cockpitKeys | mayorKey},
	{"GET /api/beads/{id}", cockpitKeys},
	{"POST /api/broadcast", cockpitKeys},
	{"GET /api/utxos/{address}", cockpitKeys},
	{"GET /api/balance/{address}", cockpitKeys},
	{"GET /api/push/vapid-public-key", cockpitKeys | appKeys},
	{"POST /api/push/subscribe", cockpitKeys | appKeys},
	{"POST /api/blobs", cockpitKeys | appKeys},
	{"GET /api/blobs/{hash}", cockpitKeys | millKey},
	{"DELETE /api/blobs/{hash}", cockpitKeys | millKey},
}

// Routes is every gated route, "METHOD /path" with {name} placeholders, in
// the table's order.
func Routes() []string {
	routes := make([]string, len(routeTable))
	for i, route := range routeTable {
		routes[i] = route.pattern
	}
	return routes
}

// Kinds of licence a collection gives: the cockpit's, or one app's.
const (
	KindCockpit = "cockpit"
	KindApp     = "app"
)

// CollectionRights is what holding a licence in one collection gives a key:
// its kind, the app's name for an app, and the routes the gate opens to it.
type CollectionRights struct {
	Collection string   `json:"collection"`
	Kind       string   `json:"kind"`
	App        string   `json:"app,omitempty"`
	Routes     []string `json:"routes"`
}

// LicenceMap is the licence map of a backend configured with the cockpit
// collections (POSTERN_COLLECTIONS) and the app collections (POSTERN_APPS,
// apps maps collection to app): for each collection, in that order, what a
// key holding only a licence in it may do. The rights come from
// rightsFromCollections and the routes from routeTable through
// access.admits, the functions the server's gate runs, so there is no second
// copy of either rule.
func LicenceMap(cockpit, appCollections []string, apps map[string]string) []CollectionRights {
	o := &options{apps: apps}
	var out []CollectionRights
	for _, collection := range append(append([]string{}, cockpit...), appCollections...) {
		granted := rightsFromCollections([]string{collection}, o)
		entry := CollectionRights{Collection: collection, Kind: KindCockpit, Routes: []string{}}
		if !granted.cockpit {
			entry.Kind = KindApp
			entry.App = strings.Join(granted.apps, ",")
		}
		for _, route := range routeTable {
			if route.who.admits(granted) {
				entry.Routes = append(entry.Routes, route.pattern)
			}
		}
		out = append(out, entry)
	}
	return out
}
