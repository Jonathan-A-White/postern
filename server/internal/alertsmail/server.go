package alertsmail

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/alerts"
	"github.com/emersion/go-smtp"
)

// MaxMessageBytes is the largest mail the receiver takes: a card alert is a
// few tens of kilobytes.
const MaxMessageBytes = 1 << 20

// maxRecipients caps the recipients of one mail: a forwarded alert has one.
const maxRecipients = 5

// backendTimeout bounds each call to the backend, so a stalled backend holds
// a sender for no longer than its own SMTP timeouts allow.
const backendTimeout = 15 * time.Second

var (
	// ErrUnknownToken is the backend's answer for a token no family owns.
	ErrUnknownToken = errors.New("alertsmail: no family has this address")
	// ErrRefused is the backend's answer for an alert it will never take
	// (400): sending it again would not help.
	ErrRefused = errors.New("alertsmail: the backend refused the alert")
)

// Inbound is the backend's half of §26 the receiver needs: whether a family
// owns a token, and the route a parsed alert is posted to.
type Inbound interface {
	// Known answers whether a family owns the token.
	Known(ctx context.Context, token string) (bool, error)
	// Post hands one alert to the family that owns the token, or answers
	// ErrUnknownToken.
	Post(ctx context.Context, token string, alert alerts.Alert) error
}

// Config is the receiver's settings.
type Config struct {
	// Domain is the alerts mail domain (POSTERN_ALERTS_DOMAIN); mail for any
	// other domain is refused, so the receiver relays nothing.
	Domain string
	// Hostname is the name the receiver greets with: the MX's host name.
	Hostname string
	// Inbound is the backend.
	Inbound Inbound
	// TLS, when set, is offered with STARTTLS.
	TLS *tls.Config
}

// NewServer is the receiver as an SMTP server: it takes mail only for a
// known token at the domain, at most MaxMessageBytes of it, offers no AUTH,
// reads each mail in memory and posts its facts, and writes nothing to disk.
func NewServer(cfg Config) *smtp.Server {
	s := smtp.NewServer(backend{cfg: cfg})
	s.Domain = cfg.Hostname
	s.MaxMessageBytes = MaxMessageBytes
	s.MaxRecipients = maxRecipients
	s.MaxLineLength = 2000
	s.ReadTimeout = 2 * time.Minute
	s.WriteTimeout = 2 * time.Minute
	s.TLSConfig = cfg.TLS
	return s
}

type backend struct{ cfg Config }

func (b backend) NewSession(c *smtp.Conn) (smtp.Session, error) {
	return &session{cfg: b.cfg, remote: c.Conn().RemoteAddr().String()}, nil
}

// session is one SMTP connection. It holds the tokens of the mail in hand
// and nothing of any mail once it is posted.
type session struct {
	cfg    Config
	remote string
	tokens []string
}

var (
	errRelay = &smtp.SMTPError{Code: 550, EnhancedCode: smtp.EnhancedCode{5, 7, 1},
		Message: "Relaying denied: this server takes mail only for its own domain"}
	errNoSuchAddress = &smtp.SMTPError{Code: 550, EnhancedCode: smtp.EnhancedCode{5, 1, 1},
		Message: "No such address"}
	errRefusedByBackend = &smtp.SMTPError{Code: 554, EnhancedCode: smtp.EnhancedCode{5, 6, 0},
		Message: "The mail could not be read into an alert"}
	errTryLater = &smtp.SMTPError{Code: 451, EnhancedCode: smtp.EnhancedCode{4, 3, 0},
		Message: "Temporary failure, try again later"}
)

// tokenPattern is a family's address token (§26): 12 of a–z and 2–7.
var tokenPattern = regexp.MustCompile(`^[a-z2-7]{` + fmt.Sprint(alerts.TokenLength) + `}$`)

func (s *session) Mail(from string, opts *smtp.MailOptions) error { return nil }

// Rcpt takes a recipient only at the domain, and only when its local part is
// a token the backend knows; anything else is refused before the body comes.
func (s *session) Rcpt(to string, opts *smtp.RcptOptions) error {
	local, domain, ok := strings.Cut(to, "@")
	if !ok || !strings.EqualFold(domain, s.cfg.Domain) {
		return errRelay
	}
	token := strings.ToLower(local)
	if !tokenPattern.MatchString(token) {
		return errNoSuchAddress
	}
	for _, held := range s.tokens {
		if held == token {
			return nil
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), backendTimeout)
	defer cancel()
	known, err := s.cfg.Inbound.Known(ctx, token)
	if err != nil {
		log.Printf("alerts-mail: asking the backend about a token: %v", err)
		return errTryLater
	}
	if !known {
		return errNoSuchAddress
	}
	s.tokens = append(s.tokens, token)
	return nil
}

// Data reads the mail into memory, parses it and posts its facts once for
// each token it was sent to. The mail itself is dropped when Data returns.
func (s *session) Data(r io.Reader) error {
	raw, err := io.ReadAll(r)
	if err != nil {
		var smtpErr *smtp.SMTPError
		if errors.As(err, &smtpErr) {
			return smtpErr
		}
		return errTryLater
	}
	facts := Parse(raw)
	alert := facts.Alert()
	ctx, cancel := context.WithTimeout(context.Background(), backendTimeout)
	defer cancel()
	posted := 0
	for _, token := range s.tokens {
		err := s.cfg.Inbound.Post(ctx, token, alert)
		switch {
		case errors.Is(err, ErrUnknownToken):
			log.Printf("alerts-mail: a token was dropped between RCPT and DATA")
		case errors.Is(err, ErrRefused):
			log.Printf("alerts-mail: the backend refused a %s alert", alert.Kind)
			if posted == 0 {
				return errRefusedByBackend
			}
		case err != nil:
			log.Printf("alerts-mail: posting a %s alert: %v", alert.Kind, err)
			if posted == 0 {
				return errTryLater
			}
		default:
			posted++
			log.Printf("alerts-mail: posted a %s alert", alert.Kind)
		}
	}
	if posted == 0 {
		return errNoSuchAddress
	}
	return nil
}

func (s *session) Reset()        { s.tokens = nil }
func (s *session) Logout() error { return nil }

// HTTPInbound is the backend over HTTP: GET /api/alerts/inbound/{token} and
// POST /api/alerts/inbound, both with Authorization: Bearer <secret>.
type HTTPInbound struct {
	// URL is the backend's base, e.g. http://127.0.0.1:8787.
	URL string
	// Secret is POSTERN_ALERTS_SECRET.
	Secret string
	// Client defaults to http.DefaultClient.
	Client *http.Client
}

func (h *HTTPInbound) client() *http.Client {
	if h.Client != nil {
		return h.Client
	}
	return http.DefaultClient
}

func (h *HTTPInbound) do(req *http.Request) (int, error) {
	req.Header.Set("Authorization", "Bearer "+h.Secret)
	resp, err := h.client().Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<14))
	return resp.StatusCode, nil
}

// Known asks the backend whether a family owns the token.
func (h *HTTPInbound) Known(ctx context.Context, token string) (bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(h.URL, "/")+"/api/alerts/inbound/"+url.PathEscape(token), nil)
	if err != nil {
		return false, err
	}
	status, err := h.do(req)
	switch {
	case err != nil:
		// The URL names the token; the log is told the failure only.
		var urlErr *url.Error
		if errors.As(err, &urlErr) {
			err = urlErr.Err
		}
		return false, fmt.Errorf("token check: %w", err)
	case status == http.StatusNoContent || status == http.StatusOK:
		return true, nil
	case status == http.StatusNotFound:
		return false, nil
	}
	return false, fmt.Errorf("token check answered %d", status)
}

// Post hands the backend one alert for the token.
func (h *HTTPInbound) Post(ctx context.Context, token string, alert alerts.Alert) error {
	body, err := json.Marshal(struct {
		Token    string `json:"token"`
		Kind     string `json:"kind"`
		Amount   string `json:"amount,omitempty"`
		Merchant string `json:"merchant,omitempty"`
		Last4    string `json:"last4,omitempty"`
		When     string `json:"when,omitempty"`
		Subject  string `json:"subject,omitempty"`
		Code     string `json:"code,omitempty"`
		// a sermon-notes alert's own two facts; every other kind leaves them out
		Title     string `json:"title,omitempty"`
		Reference string `json:"reference,omitempty"`
	}{token, alert.Kind, alert.Amount, alert.Merchant, alert.Last4, alert.When, alert.Subject, alert.Code, alert.Title, alert.Reference})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(h.URL, "/")+"/api/alerts/inbound", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	status, err := h.do(req)
	switch {
	case err != nil:
		return err
	case status == http.StatusCreated || status == http.StatusOK:
		return nil
	case status == http.StatusNotFound:
		return ErrUnknownToken
	case status == http.StatusBadRequest:
		return ErrRefused
	}
	return fmt.Errorf("inbound answered %d", status)
}
