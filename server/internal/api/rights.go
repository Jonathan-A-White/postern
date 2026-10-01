package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/Jonathan-A-White/postern/server/internal/auth"
)

// rights is what a proved key may do (docs/protocol.md §19, "Who may do
// what"): a cockpit key everything; the mill key its own records, grist to
// anyone and blobs; an app key its own records, grist to the mill and
// uploads; the Mayor's key the event stream, licence or not (§20). apps
// names the apps a key's licences open, cockpit or not.
type rights struct {
	cockpit bool
	mill    bool
	mayor   bool
	apps    []string
}

func (r rights) any() bool { return r.cockpit || r.mill || r.mayor || len(r.apps) > 0 }

// access is the set of kinds of key a route admits.
type access uint8

const (
	cockpitKeys access = 1 << iota
	millKey
	appKeys
	mayorKey

	// everyKey is every licensed kind of key: the Mayor's key without a
	// licence opens only the routes that name it.
	everyKey = cockpitKeys | millKey | appKeys
)

func (a access) admits(r rights) bool {
	return (r.cockpit && a&cockpitKeys != 0) ||
		(r.mill && a&millKey != 0) ||
		(r.mayor && a&mayorKey != 0) ||
		(len(r.apps) > 0 && !r.cockpit && a&appKeys != 0)
}

// rightsForRoute is rightsFor for a request to a route that admits who: the
// Mayor's key is let in without waiting on the licence reader when what it
// has without one (the mayor right, plus any licence answer already in hand)
// admits it, so a cold or slow licence walk never holds up the Talk line.
// Only a route the mayor right does not open waits on the walk.
func rightsForRoute(pubKeyHex string, checker auth.LicenceChecker, o *options, who access) (rights, error) {
	if o.mayorKey != "" && strings.EqualFold(pubKeyHex, o.mayorKey) && !strings.EqualFold(pubKeyHex, o.millKey) {
		var r rights
		if cached, ok := checker.(cachedChecker); ok {
			if collections, have := cached.CachedCollections(pubKeyHex); have {
				r = rightsFromCollections(collections, o)
			}
		}
		r.mayor = true
		if who.admits(r) {
			return r, nil
		}
	}
	return rightsFor(pubKeyHex, checker, o)
}

// cachedChecker is a checker that can name a key's collections from what it
// already knows, without waiting on the chain (*auth.CachedChecker).
type cachedChecker interface {
	CachedCollections(pubKeyHex string) ([]string, bool)
}

// rightsFor works out what pubKeyHex may do. The mill key (o.millKey) is
// vouched for by configuration and needs no licence. Otherwise each
// collection the key holds a licence in is an app's (o.apps maps collection
// to app) or the cockpit's: the licence rule only counts collections the
// backend was configured with, so any other held collection is one of
// POSTERN_COLLECTIONS. A checker that cannot name collections licenses
// every key it holds as a cockpit key, as before §19.
//
// The Mayor's key (o.mayorKey) is vouched for by configuration too, for the
// event stream only (§20): it also gets whatever its licences give it, and
// keeps the mayor right even when the licence check fails, so a chain
// outage never cuts the Talk line (the error is still returned).
func rightsFor(pubKeyHex string, checker auth.LicenceChecker, o *options) (rights, error) {
	if o.millKey != "" && strings.EqualFold(pubKeyHex, o.millKey) {
		return rights{mill: true}, nil
	}
	r, err := licensedRights(pubKeyHex, checker, o)
	if err != nil {
		r = rights{}
	}
	if o.mayorKey != "" && strings.EqualFold(pubKeyHex, o.mayorKey) {
		r.mayor = true
	}
	return r, err
}

// licensedRights is what pubKeyHex's licences alone give it (rightsFor).
func licensedRights(pubKeyHex string, checker auth.LicenceChecker, o *options) (rights, error) {
	named, ok := checker.(auth.CollectionChecker)
	if !ok {
		held, err := checker.Held(pubKeyHex)
		return rights{cockpit: held}, err
	}
	collections, err := named.HeldCollections(pubKeyHex)
	if err != nil {
		return rights{}, err
	}
	return rightsFromCollections(collections, o), nil
}

// rightsFromCollections is what holding licences in collections gives a key.
func rightsFromCollections(collections []string, o *options) rights {
	var r rights
	for _, collection := range collections {
		app, isApp := o.apps[collection]
		switch {
		case !isApp:
			r.cockpit = true
		case !contains(r.apps, app):
			r.apps = append(r.apps, app)
		}
	}
	return r
}

// rightsKey is the request-context key requireLicence stores a proved
// key's rights under.
type rightsKey struct{}

func rightsOf(ctx context.Context) rights {
	r, _ := ctx.Value(rightsKey{}).(rights)
	return r
}

// withCORS answers the origins in allowed (docs/protocol.md §19, "Reaching
// the backend from another origin"): their responses carry
// Access-Control-Allow-Origin, and their OPTIONS preflights are answered 204.
// Origins compare case-insensitively. Every other origin gets no CORS
// headers at all.
func withCORS(allowed []string, next http.Handler) http.Handler {
	if len(allowed) == 0 {
		return next
	}
	lowered := make([]string, len(allowed))
	for i, origin := range allowed {
		lowered[i] = strings.ToLower(origin)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" || !contains(lowered, strings.ToLower(origin)) {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
		if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}
