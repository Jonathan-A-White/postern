package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/licence"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
)

// A key that has never had a transaction (WhatsOnChain answers 404 for its
// confirmed history) is unlicensed, not a chain failure: the checker answers
// false with no error, which the API turns into 401 rather than 502.
func TestCachedCheckerAnswersFalseNotAnErrorForAKeyWithNoHistory(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/unconfirmed/history") {
			w.Write([]byte(`{"result":[],"error":""}`))
			return
		}
		http.Error(w, "Not Found", http.StatusNotFound)
	}))
	t.Cleanup(server.Close)
	client := woc.NewClient(server.URL, woc.WithMinSpacing(0), woc.WithSleep(func(time.Duration) {}))

	issuer, holder := testPubKeyHex(t), testPubKeyHex(t)
	checker := NewCachedChecker(client, time.Minute, WithRule(licence.Rule{IssuerKey: issuer}))

	held, err := checker.Held(holder)
	if err != nil {
		t.Fatalf("Held: %v, want no error for a key with no history", err)
	}
	if held {
		t.Fatal("held = true, want false")
	}
}
