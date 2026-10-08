package api

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/auth"
	"github.com/btcsuite/btcd/btcec/v2"
)

// captureLog sends the standard logger's output to a buffer until the test ends.
func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	return &buf
}

func logLines(buf *bytes.Buffer) []string {
	text := strings.TrimSpace(buf.String())
	if text == "" {
		return nil
	}
	return strings.Split(text, "\n")
}

// A refusal writes one log line: status, reason in words, route and the key's
// first 12 hex characters, never a nonce or signature (mw-t64a3.25).
func TestEveryRefusalLogsOneLineAndNamesAStableReason(t *testing.T) {
	key, err := btcec.NewPrivateKey()
	if err != nil {
		t.Fatalf("btcec.NewPrivateKey: %v", err)
	}
	keyHex := hex.EncodeToString(key.PubKey().SerializeCompressed())

	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	expiring := auth.NewNonceStore(time.Minute, auth.WithClock(func() time.Time { return now }))

	cases := []struct {
		name    string
		status  int
		reason  string // the machine-readable body field
		words   string // what the log line says in words
		wantKey string // "-" when the header named no key
		route   string
		attempt func(t *testing.T) *http.Response
	}{
		{
			name: "no header", status: 401, reason: "malformed_authorization", words: "missing or malformed Authorization header",
			wantKey: "-", route: "GET /api/messages",
			attempt: func(t *testing.T) *http.Response {
				server, _, _, _ := newTestServerWithChecker(t, http.NotFound, &stubChecker{held: true})
				resp, err := http.Get(server.URL + "/api/messages")
				if err != nil {
					t.Fatal(err)
				}
				return resp
			},
		},
		{
			name: "nonce reused", status: 401, reason: "nonce", words: "nonce is missing, expired, or already used",
			wantKey: keyHex[:12], route: "GET /api/messages",
			attempt: func(t *testing.T) *http.Response {
				server, _, _, _ := newTestServerWithChecker(t, http.NotFound, &stubChecker{held: true})
				header := authorizedAs(t, server, key)
				for i := 0; i < 2; i++ {
					req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/messages", nil)
					req.Header = header
					resp, err := http.DefaultClient.Do(req)
					if err != nil {
						t.Fatal(err)
					}
					if i == 1 {
						return resp
					}
					resp.Body.Close()
				}
				return nil
			},
		},
		{
			name: "nonce expired", status: 401, reason: "nonce", words: "nonce is missing, expired, or already used",
			wantKey: keyHex[:12], route: "GET /api/messages",
			attempt: func(t *testing.T) *http.Response {
				server, _, _, _ := newTestServerFull(t, http.NotFound, &stubChecker{held: true}, expiring)
				header := authorizedAs(t, server, key)
				now = now.Add(5 * time.Minute)
				req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/messages", nil)
				req.Header = header
				resp, err := http.DefaultClient.Do(req)
				if err != nil {
					t.Fatal(err)
				}
				return resp
			},
		},
		{
			name: "bad signature", status: 401, reason: "signature", words: "signature does not verify",
			wantKey: keyHex[:12], route: "GET /api/messages",
			attempt: func(t *testing.T) *http.Response {
				server, _, _, _ := newTestServerWithChecker(t, http.NotFound, &stubChecker{held: true})
				other, _ := btcec.NewPrivateKey()
				header := authorizedAs(t, server, other)
				parts := strings.SplitN(strings.TrimPrefix(header.Get("Authorization"), "Postern2 "), ":", 3)
				header.Set("Authorization", "Postern2 "+keyHex+":"+parts[1]+":"+parts[2])
				req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/messages", nil)
				req.Header = header
				resp, err := http.DefaultClient.Do(req)
				if err != nil {
					t.Fatal(err)
				}
				return resp
			},
		},
		{
			name: "no licence", status: 401, reason: "no_licence", words: "no licence held",
			wantKey: keyHex[:12], route: "GET /api/messages",
			attempt: func(t *testing.T) *http.Response {
				server, _, _, _ := newTestServerWithChecker(t, http.NotFound, &stubChecker{held: false})
				req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/messages", nil)
				signRequest(t, server, key, req)
				resp, err := http.DefaultClient.Do(req)
				if err != nil {
					t.Fatal(err)
				}
				return resp
			},
		},
		{
			name: "licence does not open the route", status: 403, reason: "forbidden", words: "does not open this route",
			wantKey: "", route: "GET /api/view", // the key prefix is filled in from the vectors below
			attempt: nil,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			buf := captureLog(t)
			wantKey := tc.wantKey
			var resp *http.Response
			if tc.attempt != nil {
				resp = tc.attempt(t)
			} else {
				s := newGristServer(t)
				priv, millHex := s.v.key(t, "mill")
				wantKey = millHex[:12]
				req, _ := http.NewRequest(http.MethodGet, s.URL+"/api/view", nil)
				signRequest(t, s.Server, priv, req)
				var err error
				if resp, err = http.DefaultClient.Do(req); err != nil {
					t.Fatal(err)
				}
			}
			defer resp.Body.Close()

			if resp.StatusCode != tc.status {
				t.Fatalf("status = %d, want %d", resp.StatusCode, tc.status)
			}
			var body struct {
				Reason string `json:"reason"`
			}
			if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
				t.Fatalf("decoding body: %v", err)
			}
			if body.Reason != tc.reason {
				t.Errorf("body reason = %q, want %q", body.Reason, tc.reason)
			}

			lines := logLines(buf)
			if len(lines) != 1 {
				t.Fatalf("log has %d lines, want exactly 1:\n%s", len(lines), buf.String())
			}
			line := lines[0]
			for _, want := range []string{"refused", strconv.Itoa(tc.status), tc.words, tc.route, "key " + wantKey} {
				if !strings.Contains(line, want) {
					t.Errorf("log line %q does not contain %q", line, want)
				}
			}
			// No hex run longer than the 12-character key prefix: no nonce, no signature, no whole key.
			for _, run := range strings.FieldsFunc(line, func(r rune) bool { return !strings.ContainsRune("0123456789abcdef", r) }) {
				if len(run) > 12 {
					t.Errorf("log line %q holds a %d-character hex run", line, len(run))
				}
			}
		})
	}
}
