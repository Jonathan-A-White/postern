package register

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Channel is how a Verify code travels: to an email or by SMS to a phone.
type Channel string

const (
	ChannelEmail Channel = "email"
	ChannelSMS   Channel = "sms"
)

// Verifier is Twilio Verify as registration uses it: send a code to an
// address, and check a code against it. Tests use a fake. An implementation
// must not put the address in an error it returns, which may be logged.
type Verifier interface {
	// Start sends a code to to over channel. ErrRejected says Twilio would
	// not send to that address.
	Start(ctx context.Context, channel Channel, to string) error
	// Check says whether code is the one sent to to. A code that is wrong,
	// expired or already used is false, nil; only a failure to ask is an error.
	Check(ctx context.Context, channel Channel, to, code string) (bool, error)
}

// ErrRejected is Twilio's refusal to send a code to an address (an address
// that is not one).
var ErrRejected = errors.New("that email or phone could not be sent a code")

const verifyBase = "https://verify.twilio.com/v2"

// Twilio is a Verifier over Twilio Verify's REST API (a Verify service,
// authenticated by the account SID and auth token).
type Twilio struct {
	accountSID, authToken, serviceSID string
	base                              string
	client                            *http.Client
}

// TwilioOption configures NewTwilio.
type TwilioOption func(*Twilio)

// WithTwilioBase points the client at another base URL, for tests.
func WithTwilioBase(base string) TwilioOption { return func(t *Twilio) { t.base = base } }

// NewTwilio is the Verifier for the Verify service serviceSID.
func NewTwilio(accountSID, authToken, serviceSID string, opts ...TwilioOption) *Twilio {
	t := &Twilio{accountSID: accountSID, authToken: authToken, serviceSID: serviceSID, base: verifyBase,
		client: &http.Client{Timeout: 20 * time.Second}}
	for _, opt := range opts {
		opt(t)
	}
	return t
}

func (t *Twilio) Start(ctx context.Context, channel Channel, to string) error {
	status, _, err := t.post(ctx, "Verifications", url.Values{"To": {to}, "Channel": {string(channel)}})
	switch {
	case err != nil:
		return err
	case status == http.StatusBadRequest:
		return ErrRejected
	case status/100 != 2:
		return fmt.Errorf("twilio verify: sending a code answered HTTP %d", status)
	}
	return nil
}

func (t *Twilio) Check(ctx context.Context, channel Channel, to, code string) (bool, error) {
	status, body, err := t.post(ctx, "VerificationCheck", url.Values{"To": {to}, "Code": {code}})
	switch {
	case err != nil:
		return false, err
	case status == http.StatusNotFound, status == http.StatusTooManyRequests, status == http.StatusBadRequest:
		// No such pending verification (expired, or already approved), too many
		// checks on it, or a code that is not the shape of one.
		return false, nil
	case status/100 != 2:
		return false, fmt.Errorf("twilio verify: checking a code answered HTTP %d", status)
	}
	var answer struct {
		Status string `json:"status"`
		Valid  bool   `json:"valid"`
	}
	if err := json.Unmarshal(body, &answer); err != nil {
		return false, errors.New("twilio verify: the answer to a check was not JSON")
	}
	return answer.Status == "approved" && answer.Valid, nil
}

// post sends form to the service's path. Its error never names the form.
func (t *Twilio) post(ctx context.Context, path string, form url.Values) (int, []byte, error) {
	endpoint := fmt.Sprintf("%s/Services/%s/%s", t.base, url.PathEscape(t.serviceSID), path)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return 0, nil, errors.New("twilio verify: building the request failed")
	}
	req.SetBasicAuth(t.accountSID, t.authToken)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := t.client.Do(req)
	if err != nil {
		var urlErr *url.Error
		if errors.As(err, &urlErr) {
			err = urlErr.Err
		}
		return 0, nil, fmt.Errorf("twilio verify: %s: %w", path, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	return resp.StatusCode, body, nil
}
