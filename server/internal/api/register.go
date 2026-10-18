package api

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"strings"

	"github.com/Jonathan-A-White/postern/server/internal/register"
)

// maxRegisterBodyBytes caps a registration request; the largest is a few
// hundred bytes.
const maxRegisterBodyBytes = 1 << 12

// WithRegistration sets the service behind POST /api/register/start,
// POST /api/register/confirm and GET /api/register/person, which are open
// (no licence: the caller has none yet). ipHeader names the header the
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
// and, if so, the keys that share its budget: the mill's lookup. It works
// with registration closed, since people already registered stay known.
func handleRegisterPerson(svc *register.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if svc != nil {
			if person, ok := svc.Person(r.URL.Query().Get("key")); ok {
				writeJSON(w, http.StatusOK, struct {
					Known bool `json:"known"`
					register.PersonView
				}{Known: true, PersonView: person})
				return
			}
		}
		writeJSON(w, http.StatusOK, struct {
			Known bool `json:"known"`
		}{})
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
	case errors.Is(err, register.ErrClosed), errors.Is(err, register.ErrBusy):
		writeError(w, http.StatusServiceUnavailable, err.Error())
	case errors.Is(err, register.ErrUpstream):
		writeError(w, http.StatusBadGateway, err.Error())
	default:
		log.Printf("register: %v", err)
		writeError(w, http.StatusInternalServerError, "registration failed")
	}
}
