// Package api wires up postern's HTTP surface: the message index and a
// thin proxy in front of WhatsOnChain for broadcasting and building
// transactions.
package api

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/auth"
	"github.com/Jonathan-A-White/postern/server/internal/beads"
	"github.com/Jonathan-A-White/postern/server/internal/blobs"
	"github.com/Jonathan-A-White/postern/server/internal/buildinfo"
	"github.com/Jonathan-A-White/postern/server/internal/chain"
	"github.com/Jonathan-A-White/postern/server/internal/events"
	"github.com/Jonathan-A-White/postern/server/internal/index"
	"github.com/Jonathan-A-White/postern/server/internal/licence"
	"github.com/Jonathan-A-White/postern/server/internal/notify"
	"github.com/Jonathan-A-White/postern/server/internal/prompts"
	"github.com/Jonathan-A-White/postern/server/internal/push"
	"github.com/Jonathan-A-White/postern/server/internal/record"
	"github.com/Jonathan-A-White/postern/server/internal/view"
	webpush "github.com/SherClockHolmes/webpush-go"
)

// webpushSubscription mirrors the browser's PushSubscription.toJSON() shape,
// the body POST /api/push/subscribe expects under "subscription".
type webpushSubscription struct {
	Endpoint string       `json:"endpoint"`
	Keys     webpush.Keys `json:"keys"`
}

const (
	maxBroadcastBodyBytes = 1 << 20 // 1 MiB, generous for a rawtx hex string
	maxSubscribeBodyBytes = 1 << 16 // 64 KiB, generous for a PushSubscription
)

// Features is what GET /api/me says this backend offers (docs/protocol.md
// §15).
var Features = []string{"direct", "events", "view", "beads", "me"}

// options are the v2 surface's collaborators, set by Option.
type options struct {
	notifier notify.Notifier
	mayorKey string
	network  string
	view     *view.File
	hub      *events.Hub
	ping     time.Duration
	beads    *beads.Fetcher
	millKey  string            // POSTERN_MILL_KEY, lower-cased; "" means no grist (§19)
	apps     map[string]string // POSTERN_APPS: an app's licence collection -> the app
	cors     []string          // POSTERN_CORS_ORIGINS
	prompts  *prompts.Store    // the saved prompts; nil answers 501

	cockpitCollections []string // POSTERN_COLLECTIONS, for GET /api/me (§15)
	appCollections     []string // POSTERN_APPS' collections in the order configured
	issuerKey          string   // POSTERN_ISSUER_KEY, lower-cased; "" if unset

	collections []meCollection // what a cockpit key's GET /api/me lists, built by NewHandler
	issuer      string         // issuerKey's testnet address; "" if unset
}

// meCollection is one entry of GET /api/me's collections (§15): a
// collection the backend knows, and the app it belongs to if it is an app's.
type meCollection struct {
	Name string `json:"name"`
	App  string `json:"app,omitempty"`
}

// DefaultPingInterval is how often GET /api/events writes a ": ping"
// comment, so no proxy idles the stream out (docs/protocol.md §10).
const DefaultPingInterval = 25 * time.Second

// Option configures NewHandler's v2 endpoints.
type Option func(*options)

// WithNotifier sets the notifier told about every directly delivered record
// POST /api/messages newly stores — the same fan-out the poller tells, which
// should include the events hub. Without it, direct records go to the hub
// alone.
func WithNotifier(n notify.Notifier) Option {
	return func(o *options) { o.notifier = n }
}

// WithIdentity sets what GET /api/me answers besides the caller's own key:
// the Mayor's public key (POSTERN_MAYOR_KEY, "" if unset) and the network.
func WithIdentity(mayorKey, network string) Option {
	return func(o *options) { o.mayorKey, o.network = mayorKey, network }
}

// WithCatalogue sets what a cockpit key's GET /api/me says about the licence
// collections (docs/protocol.md §15): cockpit is POSTERN_COLLECTIONS, apps the
// collections of POSTERN_APPS in the order configured (their app names come
// from WithGrist), and issuerKey is POSTERN_ISSUER_KEY, whose testnet address
// is answered as "issuer" ("" leaves it out). Without it neither field is
// answered.
func WithCatalogue(cockpit, apps []string, issuerKey string) Option {
	return func(o *options) {
		o.cockpitCollections, o.appCollections, o.issuerKey = cockpit, apps, strings.ToLower(issuerKey)
	}
}

// WithEvents sets the hub GET /api/events streams from, and how often it
// pings. Without it the handler makes its own hub, and pings every
// DefaultPingInterval.
func WithEvents(hub *events.Hub, ping time.Duration) Option {
	return func(o *options) { o.hub, o.ping = hub, ping }
}

// WithBeads sets the fetcher GET /api/beads/{id} runs (POSTERN_BEAD_CMD).
// Without it, GET /api/beads/{id} answers 501 for any valid id.
func WithBeads(b *beads.Fetcher) Option {
	return func(o *options) { o.beads = b }
}

// WithGrist sets the mill's key (POSTERN_MILL_KEY) and the apps whose
// licences open the grist door (POSTERN_APPS: collection -> app), per
// docs/protocol.md §19. Without it no key is a mill or an app key, and the
// backend behaves as it did before §19.
func WithGrist(millKey string, apps map[string]string) Option {
	return func(o *options) { o.millKey, o.apps = strings.ToLower(millKey), apps }
}

// WithCORS sets the origins allowed to call the backend from a browser on
// another origin (POSTERN_CORS_ORIGINS, docs/protocol.md §19).
func WithCORS(origins []string) Option {
	return func(o *options) { o.cors = origins }
}

// WithPrompts sets the store GET /api/prompts and its siblings serve. Without
// it those routes answer 501.
func WithPrompts(store *prompts.Store) Option {
	return func(o *options) { o.prompts = store }
}

// WithView sets the view file GET /api/view serves (POSTERN_VIEW_FILE).
// Without it, GET /api/view answers 404.
func WithView(v *view.File) Option {
	return func(o *options) { o.view = v }
}

// NewHandler builds the full /api/* surface (plus /healthz) backed by store
// and client. vapidPublicKey is handed to GET /api/push/vapid-public-key;
// pushStore backs POST /api/push/subscribe; blobStore backs POST/GET
// /api/blobs. Every /api endpoint except GET /api/challenge requires a
// signed, licensed proof (requireLicence), checked against nonces and
// checker, and admits only the kinds of key it names (docs/protocol.md
// §19). opts configure the v2 endpoints (docs/protocol.md §9–15, §19).
func NewHandler(store *index.Store, client chain.Chain, vapidPublicKey string, pushStore *push.Store, blobStore *blobs.Store, nonces *auth.NonceStore, checker auth.LicenceChecker, opts ...Option) http.Handler {
	o := options{network: "testnet", ping: DefaultPingInterval}
	for _, opt := range opts {
		opt(&o)
	}
	if o.hub == nil {
		o.hub = events.NewHub()
	}
	for _, name := range o.cockpitCollections {
		o.collections = append(o.collections, meCollection{Name: name})
	}
	for _, name := range o.appCollections {
		o.collections = append(o.collections, meCollection{Name: name, App: o.apps[name]})
	}
	if o.issuerKey != "" {
		// A malformed key (config validates it) leaves the issuer out.
		o.issuer, _ = licence.AddressForPublicKey(o.issuerKey)
	}
	if o.ping <= 0 {
		o.ping = DefaultPingInterval
	}
	if o.notifier == nil {
		o.notifier = o.hub
	}
	if o.beads == nil {
		o.beads = beads.New("")
	}

	gate := func(who access, next http.HandlerFunc) http.HandlerFunc {
		return requireLicence(nonces, checker, &o, who, next)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", handleHealthz)
	mux.HandleFunc("GET /api/challenge", handleChallenge(nonces))
	mux.HandleFunc("GET /api/messages", gate(everyKey, handleMessages(store)))
	mux.HandleFunc("POST /api/messages", gate(everyKey, handleDirectMessage(store, o.notifier, o.millKey)))
	mux.HandleFunc("GET /api/me", gate(everyKey, handleMe(&o)))
	mux.HandleFunc("GET /api/view", gate(cockpitKeys, handleView(o.view)))
	here := newPresence()
	mux.HandleFunc("GET /api/events", gate(cockpitKeys|mayorKey, handleEvents(store, o.hub, o.view, o.ping, here)))
	mux.HandleFunc("GET /api/presence", gate(cockpitKeys, handlePresence(here, o.mayorKey)))
	mux.HandleFunc("GET /api/prompts", gate(everyKey|mayorKey, handlePromptList(o.prompts)))
	mux.HandleFunc("GET /api/prompts/{name}", gate(everyKey|mayorKey, handlePromptGet(o.prompts)))
	mux.HandleFunc("PUT /api/prompts/{name}", gate(cockpitKeys, handlePromptPut(o.prompts)))
	mux.HandleFunc("DELETE /api/prompts/{name}", gate(cockpitKeys, handlePromptDelete(o.prompts)))
	mux.HandleFunc("GET /api/beads/{id}", gate(cockpitKeys, handleBead(o.beads)))
	mux.HandleFunc("POST /api/broadcast", gate(cockpitKeys, handleBroadcast(client)))
	mux.HandleFunc("GET /api/utxos/{address}", gate(cockpitKeys, handleUtxos(client)))
	mux.HandleFunc("GET /api/balance/{address}", gate(cockpitKeys, handleBalance(client)))
	mux.HandleFunc("GET /api/push/vapid-public-key", gate(cockpitKeys|appKeys, handleVAPIDPublicKey(vapidPublicKey)))
	mux.HandleFunc("POST /api/push/subscribe", gate(cockpitKeys|appKeys, handlePushSubscribe(pushStore)))
	mux.HandleFunc("POST /api/blobs", gate(cockpitKeys|appKeys, handleBlobUpload(blobStore)))
	mux.HandleFunc("GET /api/blobs/{hash}", gate(cockpitKeys|millKey, handleBlobDownload(blobStore)))
	mux.HandleFunc("DELETE /api/blobs/{hash}", gate(cockpitKeys|millKey, handleBlobDelete(blobStore, store, o.millKey)))
	return withCORS(o.cors, mux)
}

// The Authorization header's scheme token: "Postern2
// <pubkeyHex>:<nonceHex>:<sigHex>", where sigHex is a DER-encoded ECDSA
// signature by the compressed secp256k1 key pubkeyHex over
// auth.MessageV2(method, raw request target, body, nonce). The older
// "Postern ..." (v1, the signature over the nonce alone) is refused with
// reasonSignatureV1 (docs/api.md).
const (
	authSchemeV2 = "Postern2 "
	authSchemeV1 = "Postern "
)

// parseAuthorization splits a "Postern2 <pubkeyHex>:<nonceHex>:<sigHex>"
// Authorization header into its three parts, reporting ok=false for anything
// else, including any empty part.
func parseAuthorization(header string) (pubKeyHex, nonce, sigHex string, ok bool) {
	if !strings.HasPrefix(header, authSchemeV2) {
		return "", "", "", false
	}
	parts := strings.Split(strings.TrimPrefix(header, authSchemeV2), ":")
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return "", "", "", false
	}
	return parts[0], parts[1], parts[2], true
}

// v1KeyPrefix is the key a refused v1 header named, for the log line, or ""
// when it names none (keyPrefix then prints "-").
func v1KeyPrefix(header string) string {
	key, _, _ := strings.Cut(strings.TrimPrefix(header, authSchemeV1), ":")
	return key
}

// authKey is the request-context key requireLicence stores the
// authenticated public key under.
type authKey struct{}

// AuthenticatedKey returns the compressed public key (hex, lower-cased) whose
// signed, licensed proof requireLicence accepted for this request's
// context, or "" outside requireLicence.
func AuthenticatedKey(ctx context.Context) string {
	key, _ := ctx.Value(authKey{}).(string)
	return key
}

// requireLicence wraps next so it only runs once the request's Authorization
// header proves a signed, licensed key: the header must carry a nonce this
// nonces store issued and hasn't already consumed, a valid signature by the
// named public key (over the method, raw request target, body hash and
// nonce), and that key must hold a licence per checker (or be the mill's
// key). Anything short of that is a 401, a v1 ("Postern ") header included
// (reason "signature-v1"); a body over blobs.MaxBodyBytes is a 413; a failure
// to check the licence itself (a chain read failing) is a 502, like this
// backend's other provider-proxy failures. A proved key whose kind who does not
// admit is a 403 (docs/protocol.md §19). An accepted request logs one line
// naming its scheme. next finds the proved key with AuthenticatedKey and what it may do
// with rightsOf.
func requireLicence(nonces *auth.NonceStore, checker auth.LicenceChecker, o *options, who access, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authorization := r.Header.Get("Authorization")
		if strings.HasPrefix(authorization, authSchemeV1) {
			refuse(w, r, http.StatusUnauthorized, reasonSignatureV1, "the v1 'Postern' scheme is no longer accepted; sign with 'Postern2'", v1KeyPrefix(authorization))
			return
		}
		pubKeyHex, nonce, sigHex, ok := parseAuthorization(authorization)
		if !ok {
			refuse(w, r, http.StatusUnauthorized, reasonMalformed, "missing or malformed Authorization header", "")
			return
		}
		if err := nonces.Spend(nonce); err != nil {
			// The wire reason is always "nonce" (every client retries once on
			// it); the log says whether it was another host's or an earlier life's.
			refuseLogged(w, r, http.StatusUnauthorized, reasonNonce, err.Error(), "nonce is missing, expired, or already used", pubKeyHex)
			return
		}
		body, ok := readSignedBody(w, r)
		if !ok {
			return
		}
		valid, err := auth.VerifySignature(pubKeyHex, auth.MessageV2(r.Method, r.RequestURI, body, nonce), sigHex)
		if err != nil || !valid {
			refuse(w, r, http.StatusUnauthorized, reasonSignature, "signature does not verify", pubKeyHex)
			return
		}
		key := strings.ToLower(pubKeyHex)
		granted, err := rightsForRoute(key, checker, o, who)
		if err != nil && !who.admits(granted) {
			writeError(w, http.StatusBadGateway, "checking licence: "+err.Error())
			return
		}
		if !granted.any() {
			refuse(w, r, http.StatusUnauthorized, reasonNoLicence, "no licence held", key)
			return
		}
		if !who.admits(granted) {
			refuse(w, r, http.StatusForbidden, reasonForbidden, "this key's licence does not open this route", key)
			return
		}
		acceptLog.Printf("accepted %s %s (scheme=v2 key %s)", r.Method, r.URL.EscapedPath(), keyPrefix(key))
		ctx := context.WithValue(r.Context(), authKey{}, key)
		next(w, r.WithContext(context.WithValue(ctx, rightsKey{}, granted)))
	}
}

// readSignedBody reads a v2 request's whole body so its hash can be checked,
// and puts the same bytes back for the route. The gate runs before the route
// and cannot know the route's own cap, so it reads up to the largest any
// route takes, blobs.MaxBodyBytes, and answers 413 beyond it; each route
// still applies its own cap to the restored body. It reports false once it
// has answered.
func readSignedBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, blobs.MaxBodyBytes))
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeError(w, http.StatusRequestEntityTooLarge, "body exceeds the largest any route takes")
			return nil, false
		}
		writeError(w, http.StatusBadRequest, "reading body: "+err.Error())
		return nil, false
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	return body, true
}

// acceptLog takes the one line each accepted request writes: the route, the
// signature scheme it came with (v2, the only one left) and the key's first 12
// hex characters. It writes where the
// standard logger does, in the same format, but is its own logger so a route's
// own log lines are told apart from the gate's.
var acceptLog = log.New(os.Stderr, "", log.LstdFlags)

// The machine-readable reason in a refusal's body ({"error", "reason"}): the
// app matches on these, never on the English in "error" (docs/api.md). Only
// reasonNoLicence is about a licence.
const (
	reasonMalformed = "malformed_authorization"
	reasonNonce     = "nonce"
	reasonSignature = "signature"
	// reasonSignatureV1 answers the retired 'Postern' scheme, whatever its signature.
	reasonSignatureV1 = "signature-v1"
	reasonNoLicence   = "no_licence"
	reasonForbidden   = "forbidden"
)

// refuse answers a refused request and logs it as one line: the status, the
// reason in words, the route and the first 12 hex characters of the key the
// request named ("-" when it named none). Never the body, a signature or a
// nonce.
func refuse(w http.ResponseWriter, r *http.Request, status int, reason, message, pubKeyHex string) {
	refuseLogged(w, r, status, reason, reason, message, pubKeyHex)
}

// refuseLogged is refuse with a finer cause for the log line than the reason
// the body carries.
func refuseLogged(w http.ResponseWriter, r *http.Request, status int, reason, cause, message, pubKeyHex string) {
	log.Printf("refused %d %s: %s (%s key %s)", status, r.Method+" "+r.URL.EscapedPath(), message, cause, keyPrefix(pubKeyHex))
	writeJSON(w, status, struct {
		Error  string `json:"error"`
		Reason string `json:"reason"`
	}{Error: message, Reason: reason})
}

// keyPrefix is the first 12 characters of a public key for a log line, or "-"
// when there is no key or what was sent is not hex (it is not logged).
func keyPrefix(pubKeyHex string) string {
	if len(pubKeyHex) < 12 {
		return "-"
	}
	prefix := strings.ToLower(pubKeyHex[:12])
	if _, err := hex.DecodeString(prefix); err != nil {
		return "-"
	}
	return prefix
}

// handleMe answers who the caller is, who the Mayor is and who the mill is,
// and tells a cockpit key the backend's collections and the issuer's address
// (docs/protocol.md §15, §19). An app's key or the mill's is never told the
// Mayor, and is offered only grist.
func handleMe(o *options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		caller := AuthenticatedKey(r.Context())
		granted := rightsOf(r.Context())
		if !granted.cockpit {
			writeJSON(w, http.StatusOK, struct {
				PubKey   string   `json:"pubkey"`
				Mill     string   `json:"mill"`
				Network  string   `json:"network"`
				Features []string `json:"features"`
				Apps     []string `json:"apps,omitempty"`
			}{PubKey: caller, Mill: o.millKey, Network: o.network, Features: []string{featureGrist}, Apps: granted.apps})
			return
		}
		features := Features
		if o.millKey != "" {
			features = append(append([]string{}, Features...), featureGrist)
		}
		writeJSON(w, http.StatusOK, struct {
			PubKey   string   `json:"pubkey"`
			Mayor    string   `json:"mayor"`
			Mill     string   `json:"mill,omitempty"`
			Network  string   `json:"network"`
			Features []string `json:"features"`

			Collections []meCollection `json:"collections,omitempty"`
			Issuer      string         `json:"issuer,omitempty"`
		}{PubKey: caller, Mayor: o.mayorKey, Mill: o.millKey, Network: o.network, Features: features, Collections: o.collections, Issuer: o.issuer})
	}
}

// featureGrist is what GET /api/me names when this backend takes grist
// (docs/protocol.md §19).
const featureGrist = "grist"

func handleChallenge(nonces *auth.NonceStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		nonce, err := nonces.Issue()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, struct {
			Nonce string `json:"nonce"`
		}{Nonce: nonce})
	}
}

func handleHealthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, struct {
		OK      bool   `json:"ok"`
		Standby bool   `json:"standby"`
		Commit  string `json:"commit"`
	}{OK: true, Commit: buildinfo.Commit()})
}

// messagesLimitCap is the most records one GET /api/messages page carries; a
// larger ?limit is clamped to it.
const messagesLimitCap = 500

func handleMessages(store *index.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sinceParam := r.URL.Query().Get("since")
		var since uint64
		if sinceParam != "" {
			parsed, err := strconv.ParseUint(sinceParam, 10, 64)
			if err != nil {
				writeError(w, http.StatusBadRequest, "since must be a non-negative integer")
				return
			}
			since = parsed
		}

		limit := 0 // absent: no limit
		if values, ok := r.URL.Query()["limit"]; ok {
			parsed, err := strconv.Atoi(values[0])
			if err != nil || parsed < 1 {
				writeError(w, http.StatusBadRequest, "limit must be a positive integer")
				return
			}
			limit = min(parsed, messagesLimitCap)
		}

		// The page is cut from the whole index, then filtered, so a page that
		// filters to nothing still moves next on.
		records, next, more := store.SinceLimit(since, limit)
		if !rightsOf(r.Context()).cockpit {
			records = ownRecords(records, AuthenticatedKey(r.Context()))
		}
		writeJSON(w, http.StatusOK, struct {
			Records []index.Record `json:"records"`
			Next    uint64         `json:"next"`
			More    bool           `json:"more"`
		}{Records: records, Next: next, More: more})
	}
}

// ownRecords keeps the records whose §1 envelope names key as to or from:
// all an app's key or the mill's may see (docs/protocol.md §19). A record
// with no readable envelope belongs to no one.
func ownRecords(records []index.Record, key string) []index.Record {
	own := []index.Record{}
	for _, rec := range records {
		env, err := record.ParseEnvelope(rec.Payload)
		if err != nil {
			continue
		}
		if strings.EqualFold(env.To, key) || strings.EqualFold(env.From, key) {
			own = append(own, rec)
		}
	}
	return own
}

func handleBroadcast(client chain.Chain) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			RawTx string `json:"rawtx"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, maxBroadcastBodyBytes)).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		if req.RawTx == "" {
			writeError(w, http.StatusBadRequest, "rawtx is required")
			return
		}

		txid, err := client.Broadcast(req.RawTx)
		if err != nil {
			writeProviderError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, struct {
			TxID string `json:"txid"`
		}{TxID: txid})
	}
}

func handleUtxos(client chain.Chain) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		address := r.PathValue("address")
		utxos, err := client.GetUtxos(address)
		if err != nil {
			writeProviderError(w, err)
			return
		}

		type utxo struct {
			TxID     string `json:"txid"`
			Vout     int    `json:"vout"`
			Satoshis int64  `json:"satoshis"`
			Height   int    `json:"height"`
		}
		out := make([]utxo, len(utxos))
		for i, u := range utxos {
			out[i] = utxo{TxID: u.TxHash, Vout: u.TxPos, Satoshis: u.Value, Height: u.Height}
		}

		writeJSON(w, http.StatusOK, struct {
			Utxos []utxo `json:"utxos"`
		}{Utxos: out})
	}
}

func handleBalance(client chain.Chain) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		address := r.PathValue("address")
		balance, err := client.GetBalance(address)
		if err != nil {
			writeProviderError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, balance)
	}
}

func handleVAPIDPublicKey(publicKey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, struct {
			PublicKey string `json:"publicKey"`
		}{PublicKey: publicKey})
	}
}

func handlePushSubscribe(store *push.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			PublicKeyHex string              `json:"pubkey"`
			Subscription webpushSubscription `json:"subscription"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, maxSubscribeBodyBytes)).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		if req.PublicKeyHex == "" {
			writeError(w, http.StatusBadRequest, "pubkey is required")
			return
		}
		if req.Subscription.Endpoint == "" {
			writeError(w, http.StatusBadRequest, "subscription.endpoint is required")
			return
		}
		if !strings.EqualFold(req.PublicKeyHex, AuthenticatedKey(r.Context())) {
			writeError(w, http.StatusForbidden, "pubkey is not the key that signed this request")
			return
		}

		sub := push.Subscription{
			PublicKeyHex: req.PublicKeyHex,
			Endpoint:     req.Subscription.Endpoint,
			Keys:         req.Subscription.Keys,
		}
		if err := store.Add(sub); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, struct{}{})
	}
}

// handleBlobUpload stores the request body as a blob, capped at
// blobs.MaxBodyBytes (413 beyond), answering 201 {hash,size} for a new blob
// or 200 for a repeat upload of the same bytes.
func handleBlobUpload(store *blobs.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, blobs.MaxBodyBytes)
		data, err := io.ReadAll(r.Body)
		if err != nil {
			var maxErr *http.MaxBytesError
			if errors.As(err, &maxErr) {
				writeError(w, http.StatusRequestEntityTooLarge, "body exceeds the attachment size cap")
				return
			}
			writeError(w, http.StatusBadRequest, "reading body: "+err.Error())
			return
		}

		hash, size, existed, err := store.Put(data)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if err := store.SetOwner(hash, AuthenticatedKey(r.Context())); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		status := http.StatusCreated
		if existed {
			status = http.StatusOK
		}
		writeJSON(w, status, struct {
			Hash string `json:"hash"`
			Size int    `json:"size"`
		}{Hash: hash, Size: size})
	}
}

// handleBlobDownload streams the blob named by the {hash} path value, 404
// if the hash is malformed or names no blob currently on disk (never
// uploaded, or already swept).
func handleBlobDownload(store *blobs.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		file, size, err := store.Open(r.PathValue("hash"))
		if err != nil {
			writeError(w, http.StatusNotFound, "blob not found")
			return
		}
		defer file.Close()

		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
		w.WriteHeader(http.StatusOK)
		io.Copy(w, file)
	}
}

// handleBlobDelete removes the blob named by the {hash} path value at once
// (docs/protocol.md §19: the mill deletes a grist's photos once it has
// answered): 204, or 404 if the hash is malformed or names no blob. A grist's
// attachments are sealed, so the backend cannot read which blobs a grist
// names; the mill key may delete only a blob whose uploader has sent a grist
// to the mill (403 otherwise), which keeps it off the Governor's own photos.
// A cockpit key deletes any blob.
func handleBlobDelete(store *blobs.Store, records *index.Store, millKey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		hash := r.PathValue("hash")
		if !rightsOf(r.Context()).cockpit {
			file, _, err := store.Open(hash)
			if err != nil {
				writeError(w, http.StatusNotFound, "blob not found")
				return
			}
			file.Close()
			if uploader, ok := store.Owner(hash); !ok || !sentGristTo(records, uploader, millKey) {
				writeError(w, http.StatusForbidden, "this blob is not named by a grist addressed to the mill")
				return
			}
		}
		if err := store.Delete(hash); err != nil {
			if errors.Is(err, blobs.ErrNotFound) {
				writeError(w, http.StatusNotFound, "blob not found")
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// sentGristTo reports whether the index holds a grist from sender to
// millKey.
func sentGristTo(records *index.Store, sender, millKey string) bool {
	if millKey == "" {
		return false
	}
	return records.Any(func(rec index.Record) bool {
		env, err := record.ParseEnvelope(rec.Payload)
		return err == nil && env.Class == record.ClassGrist &&
			strings.EqualFold(env.To, millKey) && strings.EqualFold(env.From, sender)
	})
}

// writeProviderError maps a chain.Chain error to an HTTP response: a
// *chain.ProviderError becomes a 502 with a short classified reply (provider,
// status, busy or not) and anything else (a network failure, an unreachable
// provider) becomes a generic 502 too — from this backend's caller's
// perspective both are just "the provider proxy failed." What the provider
// sent is logged here, never relayed: a 429 from WhatsOnChain is an nginx
// HTML page (mw-nxj49n).
func writeProviderError(w http.ResponseWriter, err error) {
	var apiErr *chain.ProviderError
	if errors.As(err, &apiErr) {
		log.Printf("provider %s said %d: %s", apiErr.Provider, apiErr.Status, apiErr.Body)
		writeJSON(w, http.StatusBadGateway, struct {
			Error    string `json:"error"`
			Provider string `json:"provider"`
			Status   int    `json:"status"`
			Busy     bool   `json:"busy"`
		}{Error: providerErrorText(apiErr), Provider: apiErr.Provider, Status: apiErr.Status, Busy: providerBusy(apiErr.Status)})
		return
	}
	writeError(w, http.StatusBadGateway, err.Error())
}

// providerBusy says a provider status is a provider that is busy or down (a
// 429, or the gateway statuses), as against one that refused the request.
func providerBusy(status int) bool {
	return status == http.StatusTooManyRequests || status == http.StatusBadGateway ||
		status == http.StatusServiceUnavailable || status == http.StatusGatewayTimeout
}

// maxReplyReason is the longest provider reason worth relaying.
const maxReplyReason = 120

// providerErrorText is "<provider> said <status>", with the provider's own
// reason after it when that is one short plain line (a node's "tx rejected")
// and the provider is not busy; a page, a long body or a busy provider's
// words stay in the log.
func providerErrorText(e *chain.ProviderError) string {
	text := fmt.Sprintf("%s said %d", e.Provider, e.Status)
	reason := strings.TrimSpace(e.Body)
	if providerBusy(e.Status) || reason == "" || len(reason) > maxReplyReason || strings.ContainsAny(reason, "<>\r\n") {
		return text
	}
	return text + ": " + reason
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, struct {
		Error string `json:"error"`
	}{Error: message})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}
