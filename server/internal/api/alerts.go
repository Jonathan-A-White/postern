package api

import (
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/alerts"
	"github.com/Jonathan-A-White/postern/server/internal/push"
	"github.com/Jonathan-A-White/postern/server/internal/register"
)

// The alerts feed (docs/protocol.md §26).

// maxAlertBodyBytes caps a parsed alert from the receiver; a real one is a few
// hundred bytes.
const maxAlertBodyBytes = 1 << 14

// maxInboundBodyBytes caps a post to POST /api/alerts/inbound: a parsed alert
// and, for a sermon-notes alert, the base64 of a notes PDF of at most
// alerts.MaxNotesBytes. It is that route's limit alone.
var maxInboundBodyBytes = maxAlertBodyBytes + base64.StdEncoding.EncodedLen(alerts.MaxNotesBytes)

// Families names the family a key belongs to: the keys of one licence, its
// devices. Family answers "" for a key that belongs to no family, which is a
// family of one.
type Families interface {
	Family(key string) string
	Keys(familyID string) []string
}

// AlertPusher pushes a new alert (one pushesKind says is worth a push) to every subscription of the given keys, with
// a charge's facts only to the subscriptions that name its card (§26, The push).
// *push.Sender is one.
type AlertPusher interface {
	NotifyAlert(keys []string, ts int64, facts push.AlertFacts) (int, error)
}

// WithAlerts sets the store behind the alerts routes, how a key's family and
// its devices are found, who pushes a new alert, the mail domain the family's
// addresses are on (POSTERN_ALERTS_DOMAIN) and the secret the receiver proves
// itself with (POSTERN_ALERTS_SECRET). Without a store, GET /api/alerts and
// its siblings answer 501; without a secret the inbound route does.
func WithAlerts(store *alerts.Store, families Families, pusher AlertPusher, domain, secret string) Option {
	return func(o *options) {
		o.alerts, o.alertFamilies, o.alertPusher, o.alertDomain, o.alertSecret = store, families, pusher, domain, secret
	}
}

// RegisterFamilies is the families of self-registration: a person's devices
// are one licence, so they are one family.
func RegisterFamilies(svc *register.Service) Families { return registerFamilies{svc} }

type registerFamilies struct{ svc *register.Service }

func (r registerFamilies) Family(key string) string {
	if person, ok := r.svc.Person(key); ok {
		return "person:" + person.PersonID
	}
	return ""
}

func (r registerFamilies) Keys(id string) []string {
	return r.svc.PersonKeys(strings.TrimPrefix(id, "person:"))
}

const keyFamilyPrefix = "key:"

// familyOf is the id of the family key belongs to: its person's, or its own.
func (o *options) familyOf(key string) string {
	if o.alertFamilies != nil {
		if id := o.alertFamilies.Family(key); id != "" {
			return id
		}
	}
	return keyFamilyPrefix + key
}

// familyKeys is every device key of the family id.
func (o *options) familyKeys(id string) []string {
	if key, alone := strings.CutPrefix(id, keyFamilyPrefix); alone {
		return []string{key}
	}
	if o.alertFamilies != nil {
		return o.alertFamilies.Keys(id)
	}
	return nil
}

// alertPush is the bare push a new alert makes: its class and time, and a title
// that says nothing about the alert; the app opens and reads its feed.
func alertPush(ts int64) push.Payload {
	return push.Payload{Class: "alert", Ts: ts, Title: "New alert"}
}

// alertFacts is what the push may carry of a stored alert; the sender decides,
// per subscription, whether a charge's words go.
func alertFacts(a alerts.Alert) push.AlertFacts {
	return push.AlertFacts{
		ID:       a.ID,
		Charge:   a.Kind == alerts.KindCharge,
		Amount:   a.Amount,
		Merchant: a.Merchant,
		Last4:    a.Last4,
	}
}

// pushesKind says whether a stored alert of kind makes a push. Only an alert a phone has something to
// do with does: a charge (the app's Waiting list holds a card to sort) and Gmail's forwarding
// confirmation (its link waits in the app's family settings to be tapped). Every other kind is stored
// and listed, and pings no one: a bare push can only be worded as a charge to sort, and the apps
// keep no card or action for amazon, zelle-sent, deposit, unread, sermon-notes or hold (a gas pump's $1.00
// pre-authorisation, which never posts as $1.00; docs/protocol.md §26).
func pushesKind(kind string) bool {
	return kind == alerts.KindCharge || kind == alerts.KindForwardConfirm
}

func alertsOff(w http.ResponseWriter, o *options) bool {
	if o.alerts == nil || o.alertDomain == "" {
		writeError(w, http.StatusNotImplemented, "this backend keeps no alerts")
		return true
	}
	return false
}

// handleAlertAddress answers POST /api/alerts/address: the family's one
// address, made on the first ask.
func handleAlertAddress(o *options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if alertsOff(w, o) {
			return
		}
		token, err := o.alerts.Address(o.familyOf(AuthenticatedKey(r.Context())))
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, struct {
			Address string `json:"address"`
		}{Address: token + "@" + o.alertDomain})
	}
}

// handleAlertList answers GET /api/alerts?since=<seq>: the family's alerts
// with a seq above since, oldest first, and next, the seq to ask from next.
func handleAlertList(o *options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if alertsOff(w, o) {
			return
		}
		var since uint64
		if raw := r.URL.Query().Get("since"); raw != "" {
			var err error
			if since, err = strconv.ParseUint(raw, 10, 64); err != nil {
				writeError(w, http.StatusBadRequest, "since must be a whole number")
				return
			}
		}
		list := o.alerts.List(o.familyOf(AuthenticatedKey(r.Context())), since)
		if list == nil {
			list = []alerts.Alert{}
		}
		next := since
		for _, a := range list {
			if a.Seq > next {
				next = a.Seq
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, struct {
			Alerts []alerts.Alert `json:"alerts"`
			Next   uint64         `json:"next"`
		}{Alerts: list, Next: next})
	}
}

// handleAlertClaim answers DELETE /api/alerts/{id}: the alert is gone for
// every phone of the family (204), or is not the family's (404).
func handleAlertClaim(o *options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if alertsOff(w, o) {
			return
		}
		found, err := o.alerts.Claim(o.familyOf(AuthenticatedKey(r.Context())), r.PathValue("id"))
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !found {
			writeError(w, http.StatusNotFound, "no such alert")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleAlertNotes answers GET /api/alerts/{id}/notes: the notes PDF of a
// sermon-notes alert of the family, as it came (application/pdf), or 404 for
// an alert of another family, an unknown id or an alert with no notes.
func handleAlertNotes(o *options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if alertsOff(w, o) {
			return
		}
		notes, found, err := o.alerts.Notes(o.familyOf(AuthenticatedKey(r.Context())), r.PathValue("id"))
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !found {
			writeError(w, http.StatusNotFound, "no notes for this alert")
			return
		}
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Length", strconv.Itoa(len(notes)))
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(notes)
	}
}

// alertTokenPattern is how the receiver's token check is registered:
// "GET /api/alerts/inbound/{token}" and the notes route,
// "GET /api/alerts/{id}/notes", both match /api/alerts/inbound/notes and
// neither is more specific, which http.ServeMux refuses. Written with a
// wildcard first segment, the check is the less specific, so the notes route
// takes that one path (a token is 12 characters, never "notes") and
// handleAlertTokenRoute answers only when the segment is "inbound".
const alertTokenPattern = "GET /api/alerts/{inbound}/{token}"

// handleAlertTokenRoute is handleAlertToken for /api/alerts/inbound/{token}
// alone; any other /api/alerts/{x}/{y} is 404.
func handleAlertTokenRoute(o *options) http.HandlerFunc {
	check := handleAlertToken(o)
	return func(w http.ResponseWriter, r *http.Request) {
		if r.PathValue("inbound") != "inbound" {
			writeError(w, http.StatusNotFound, "no such route")
			return
		}
		check(w, r)
	}
}

// inboundAlert is what the receiver posts: the address token the mail came to
// and the parsed facts. An unknown field, a mail body above all, is refused.
type inboundAlert struct {
	Token string `json:"token"`
	alerts.Alert
}

// receiverProved answers whether the request carries the receiver's shared
// secret, and answers it itself when it does not: 501 with no secret
// configured, 401 for a wrong or missing one.
func receiverProved(w http.ResponseWriter, r *http.Request, o *options) bool {
	if o.alertSecret == "" {
		writeError(w, http.StatusNotImplemented, "this backend takes no inbound alerts")
		return false
	}
	given, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if subtle.ConstantTimeCompare([]byte(given), []byte(o.alertSecret)) != 1 {
		log.Printf("refused 401 %s %s: wrong or missing secret", r.Method, r.URL.Path)
		writeJSON(w, http.StatusUnauthorized, struct {
			Error  string `json:"error"`
			Reason string `json:"reason"`
		}{Error: "wrong or missing secret", Reason: reasonSignature})
		return false
	}
	return true
}

// handleAlertToken answers GET /api/alerts/inbound/{token}: whether a family
// owns the token (204) or not (404), for the receiver, proved by the shared
// secret, to take a mail or refuse it before its body is sent.
func handleAlertToken(o *options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if alertsOff(w, o) || !receiverProved(w, r, o) {
			return
		}
		if _, ok := o.alerts.FamilyOf(r.PathValue("token")); !ok {
			writeError(w, http.StatusNotFound, "no family has this address")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleAlertInbound answers POST /api/alerts/inbound: a parsed alert from the
// receiver, proved by the shared secret (Authorization: Bearer <secret>), not
// by a key. It is stored for the family that owns the token and, when a phone has something to do
// with it (pushesKind), pushed to every phone of the family.
func handleAlertInbound(o *options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if alertsOff(w, o) {
			return
		}
		if !receiverProved(w, r, o) {
			return
		}
		decoder := json.NewDecoder(io.LimitReader(r.Body, int64(maxInboundBodyBytes)))
		decoder.DisallowUnknownFields()
		var in inboundAlert
		if err := decoder.Decode(&in); err != nil {
			writeError(w, http.StatusBadRequest, "an alert is JSON of parsed facts only: "+err.Error())
			return
		}
		stored, family, err := o.alerts.Add(in.Token, in.Alert)
		var invalid *alerts.InvalidError
		switch {
		case errors.Is(err, alerts.ErrUnknownToken):
			writeError(w, http.StatusNotFound, "no family has this address")
			return
		case errors.As(err, &invalid):
			writeError(w, http.StatusBadRequest, invalid.Msg)
			return
		case err != nil:
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if o.alertPusher != nil && pushesKind(stored.Kind) {
			if _, err := o.alertPusher.NotifyAlert(o.familyKeys(family), time.Now().Unix(), alertFacts(stored)); err != nil {
				log.Printf("pushing alert %s: %v", stored.ID, err)
			}
		}
		writeJSON(w, http.StatusCreated, struct {
			ID  string `json:"id"`
			Seq uint64 `json:"seq"`
		}{ID: stored.ID, Seq: stored.Seq})
	}
}
