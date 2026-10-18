package api

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"strings"

	"github.com/Jonathan-A-White/postern/server/internal/auth"
	"github.com/Jonathan-A-White/postern/server/internal/register"
)

// maxRegisterBodyBytes caps a registration request; the largest is a few
// hundred bytes.
const maxRegisterBodyBytes = 1 << 12

// WithRegistration sets the service behind POST /api/register/start and
// POST /api/register/confirm, which are open (no licence: the caller has none
// yet), and GET /api/register/person, PATCH and DELETE /api/register/device, which
// are signed but need no licence on the chain. ipHeader names the header the
// proxy in front sets to the caller's address (nginx: X-Real-IP, POSTERN_REGISTER_IP_HEADER),
// for the per-IP limits; "" uses the connection's own address, which behind
// a proxy is every caller at once. Without it start and confirm answer 503.
func WithRegistration(svc *register.Service, ipHeader string) Option {
	return func(o *options) { o.register, o.registerIPHeader = svc, ipHeader }
}

// clientIP is the address the per-IP limits count: the named header when the
// proxy sets one, else the peer's. The header is trusted only when named, so
// a backend not behind such a proxy cannot be talked into believing it.
func clientIP(r *http.Request, header string) string {
	if header != "" {
		if v := strings.TrimSpace(strings.Split(r.Header.Get(header), ",")[0]); v != "" {
			return v
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func handleRegisterStart(svc *register.Service, ipHeader string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if svc == nil || !svc.Open() {
			writeError(w, http.StatusServiceUnavailable, register.ErrClosed.Error())
			return
		}
		if !svc.AllowStart(clientIP(r, ipHeader)) {
			writeError(w, http.StatusTooManyRequests, "too many tries; wait a while and try again")
			return
		}
		var in struct {
			Email     string `json:"email"`
			Phone     string `json:"phone"`
			DeviceKey string `json:"deviceKey"`
		}
		if !readRegisterBody(w, r, &in) {
			return
		}
		id, err := svc.Start(r.Context(), in.Email, in.Phone, in.DeviceKey)
		if err != nil {
			writeRegisterError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, struct {
			RegistrationID string `json:"registrationId"`
		}{RegistrationID: id})
	}
}

func handleRegisterConfirm(svc *register.Service, ipHeader string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if svc == nil || !svc.Open() {
			writeError(w, http.StatusServiceUnavailable, register.ErrClosed.Error())
			return
		}
		if !svc.AllowConfirm(clientIP(r, ipHeader)) {
			writeError(w, http.StatusTooManyRequests, "too many tries; wait a while and try again")
			return
		}
		var in struct {
			RegistrationID string `json:"registrationId"`
			EmailCode      string `json:"emailCode"`
			PhoneCode      string `json:"phoneCode"`
		}
		if !readRegisterBody(w, r, &in) {
			return
		}
		result, err := svc.Confirm(r.Context(), in.RegistrationID, in.EmailCode, in.PhoneCode, r.UserAgent())
		if err != nil {
			writeRegisterError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	}
}

// handleRegisterPerson answers whether a key belongs to a registered person
// and, if so, the keys that share its budget. The answer links a person's
// devices, so it is signed ('Postern2'): the mill's key (POSTERN_MILL_KEY)
// may ask after any key, the mill's lookup; one of the person's own devices
// may ask after its person's keys (Lampas's My devices). Anyone else is 403,
// the same for a registered key as for an unknown one, and an unsigned
// request 401. It works with registration closed, since people already
// registered stay known.
func handleRegisterPerson(svc *register.Service, nonces *auth.NonceStore, millKey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		signer, ok := verifyProof(w, r, nonces)
		if !ok {
			return
		}
		key := r.URL.Query().Get("key")
		if millKey != "" && signer == millKey {
			if svc != nil {
				if person, ok := svc.Person(key); ok {
					writePerson(w, person)
					return
				}
			}
			writeJSON(w, http.StatusOK, struct {
				Known bool `json:"known"`
			}{})
			return
		}
		if svc != nil {
			if person, err := svc.PersonForDevice(signer, key); err == nil {
				writePerson(w, person)
				return
			}
		}
		refuse(w, r, http.StatusForbidden, reasonForbidden, "only the mill, or a device of that person, may ask after a key", signer)
	}
}

func writePerson(w http.ResponseWriter, person register.PersonView) {
	writeJSON(w, http.StatusOK, struct {
		Known bool `json:"known"`
		register.PersonView
	}{Known: true, PersonView: person})
}

// handleRegisterDevice is DELETE /api/register/device {deviceKey, personId}:
// signed ('Postern2') by a device of that person, it has the site issuer
// revoke deviceKey's licence and frees its slot, and answers the person's
// devices left.
func handleRegisterDevice(svc *register.Service, nonces *auth.NonceStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if svc == nil {
			writeError(w, http.StatusServiceUnavailable, register.ErrClosed.Error())
			return
		}
		signer, ok := verifyProof(w, r, nonces)
		if !ok {
			return
		}
		var in struct {
			DeviceKey string `json:"deviceKey"`
			PersonID  string `json:"personId"`
		}
		if !readRegisterBody(w, r, &in) {
			return
		}
		result, err := svc.RemoveDevice(in.PersonID, signer, in.DeviceKey)
		if err != nil {
			writeRegisterError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, struct {
			PersonID string            `json:"personId"`
			Devices  []register.Device `json:"devices"`
		}{result.PersonID, result.Devices})
	}
}

// handleRegisterRenameDevice is PATCH /api/register/device {deviceKey, name}:
// signed ('Postern2') by a device of the same person as deviceKey, it renames
// that device and answers the person's devices.
func handleRegisterRenameDevice(svc *register.Service, nonces *auth.NonceStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if svc == nil {
			writeError(w, http.StatusServiceUnavailable, register.ErrClosed.Error())
			return
		}
		signer, ok := verifyProof(w, r, nonces)
		if !ok {
			return
		}
		var in struct {
			DeviceKey string `json:"deviceKey"`
			Name      string `json:"name"`
		}
		if !readRegisterBody(w, r, &in) {
			return
		}
		result, err := svc.RenameDevice(signer, in.DeviceKey, in.Name)
		if err != nil {
			writeRegisterError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, struct {
			PersonID string            `json:"personId"`
			Devices  []register.Device `json:"devices"`
		}{result.PersonID, result.Devices})
	}
}

func readRegisterBody(w http.ResponseWriter, r *http.Request, into any) bool {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRegisterBodyBytes))
	if err != nil || json.Unmarshal(body, into) != nil {
		writeError(w, http.StatusBadRequest, "the request body is not the JSON this expects")
		return false
	}
	return true
}

// writeRegisterError maps a registration refusal to its status. A message is
// only ever one of register's own, none of which names an address.
func writeRegisterError(w http.ResponseWriter, err error) {
	var invalid *register.InvalidError
	var wrong *register.WrongCodeError
	switch {
	case errors.As(err, &wrong):
		writeJSON(w, http.StatusBadRequest, struct {
			Error     string `json:"error"`
			TriesLeft int    `json:"triesLeft"`
		}{Error: wrong.Error(), TriesLeft: wrong.TriesLeft})
	case errors.As(err, &invalid), errors.Is(err, register.ErrRejected):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, register.ErrGone):
		writeError(w, http.StatusGone, err.Error())
	case errors.Is(err, register.ErrEmailTaken), errors.Is(err, register.ErrFull), errors.Is(err, register.ErrDeviceTaken):
		writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, register.ErrClosed), errors.Is(err, register.ErrBusy), errors.Is(err, register.ErrByHand):
		writeError(w, http.StatusServiceUnavailable, err.Error())
	case errors.Is(err, register.ErrUpstream), errors.Is(err, register.ErrIssue), errors.Is(err, register.ErrRevoke):
		writeError(w, http.StatusBadGateway, err.Error())
	case errors.Is(err, register.ErrTooMany), errors.Is(err, register.ErrSendCap):
		writeError(w, http.StatusTooManyRequests, err.Error())
	case errors.Is(err, register.ErrNotYours):
		writeError(w, http.StatusForbidden, err.Error())
	case errors.Is(err, register.ErrNoDevice):
		writeError(w, http.StatusNotFound, err.Error())
	default:
		log.Printf("register: %v", err)
		writeError(w, http.StatusInternalServerError, "registration failed")
	}
}
