package api

import (
	"crypto/subtle"
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

// Families names the family a key belongs to: the keys of one licence, its
// devices. Family answers "" for a key that belongs to no family, which is a
// family of one.
type Families interface {
	Family(key string) string
	Keys(familyID string) []string
}

// AlertPusher pushes a payload to every subscription of the given keys.
// *push.Sender is one.
type AlertPusher interface {
	NotifyKeys(keys []string, payload push.Payload) (int, error)
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

// alertPush is the push a new alert makes: its class and time, and a title
// that says nothing about the alert; the app opens and reads its feed.
func alertPush(ts int64) push.Payload {
	return push.Payload{Class: "alert", Ts: ts, Title: "New alert"}
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

// inboundAlert is what the receiver posts: the address token the mail came to
// and the parsed facts. An unknown field, a mail body above all, is refused.
type inboundAlert struct {
	Token string `json:"token"`
	alerts.Alert
}

// handleAlertInbound answers POST /api/alerts/inbound: a parsed alert from the
// receiver, proved by the shared secret (Authorization: Bearer <secret>), not
// by a key. It is stored for the family that owns the token and pushed to every
// phone of the family.
func handleAlertInbound(o *options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if alertsOff(w, o) {
			return
		}
		if o.alertSecret == "" {
			writeError(w, http.StatusNotImplemented, "this backend takes no inbound alerts")
			return
		}
		given, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if subtle.ConstantTimeCompare([]byte(given), []byte(o.alertSecret)) != 1 {
			log.Printf("refused 401 POST /api/alerts/inbound: wrong or missing secret")
			writeJSON(w, http.StatusUnauthorized, struct {
				Error  string `json:"error"`
				Reason string `json:"reason"`
			}{Error: "wrong or missing secret", Reason: reasonSignature})
			return
		}
		decoder := json.NewDecoder(io.LimitReader(r.Body, maxAlertBodyBytes))
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
		if o.alertPusher != nil {
			if _, err := o.alertPusher.NotifyKeys(o.familyKeys(family), alertPush(time.Now().Unix())); err != nil {
				log.Printf("pushing alert %s: %v", stored.ID, err)
			}
		}
		writeJSON(w, http.StatusCreated, struct {
			ID  string `json:"id"`
			Seq uint64 `json:"seq"`
		}{ID: stored.ID, Seq: stored.Seq})
	}
}
