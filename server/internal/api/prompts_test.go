package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/Jonathan-A-White/postern/server/internal/prompts"
)

// The prompts the backend keeps (server/README.md): any licensed key reads
// them, only a cockpit key (the home) writes them.

func newPromptsServer(t *testing.T) gristServer {
	t.Helper()
	store, err := prompts.OpenStore(t.TempDir())
	if err != nil {
		t.Fatalf("prompts.OpenStore: %v", err)
	}
	return newGristServer(t, WithPrompts(store))
}

const sweepPrompt = `{"name":"sweep","summary":"Sweep a place","signature":[{"flag":"--duration","type":"duration","default":"30m","help":"how long"},{"flag":"--who","type":"string","required":true}],"body":"Sweep {{who}}."}`

func (s gristServer) putPrompt(t *testing.T, as, name, body string) (int, string) {
	t.Helper()
	resp := s.do(t, as, http.MethodPut, "/api/prompts/"+name, body)
	defer resp.Body.Close()
	var out strings.Builder
	buf := make([]byte, 4096)
	for {
		n, err := resp.Body.Read(buf)
		out.Write(buf[:n])
		if err != nil {
			break
		}
	}
	return resp.StatusCode, out.String()
}

func TestAPutThenGetRoundTripsAPromptWithItsSignature(t *testing.T) {
	s := newPromptsServer(t)
	if status, body := s.putPrompt(t, "governor", "sweep", sweepPrompt); status != http.StatusOK {
		t.Fatalf("PUT as governor: status %d (%s), want 200", status, body)
	}
	_, governorHex := s.v.key(t, "governor")

	resp := s.do(t, "governor", http.MethodGet, "/api/prompts/sweep", "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/prompts/sweep: status %d, want 200", resp.StatusCode)
	}
	var got prompts.Prompt
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decoding: %v", err)
	}
	if got.Name != "sweep" || got.Summary != "Sweep a place" || got.Body != "Sweep {{who}}." {
		t.Fatalf("prompt = %+v", got)
	}
	if len(got.Signature) != 2 || got.Signature[0].Flag != "--duration" || got.Signature[0].Type != "duration" || got.Signature[0].Default != "30m" || got.Signature[0].Help != "how long" || !got.Signature[1].Required {
		t.Fatalf("signature = %+v", got.Signature)
	}
	if got.UpdatedBy != governorHex || got.UpdatedAt.IsZero() {
		t.Fatalf("stamp = by %q at %v, want the writing key and a time", got.UpdatedBy, got.UpdatedAt)
	}
}

func TestEveryLicensedKeyReadsThePromptsAndOnlyACockpitKeyWritesThem(t *testing.T) {
	s := newPromptsServer(t)
	if status, body := s.putPrompt(t, "governor", "sweep", sweepPrompt); status != http.StatusOK {
		t.Fatalf("seeding: %d %s", status, body)
	}
	for _, as := range []string{"governor", "cairnPhone", "mill"} {
		for _, path := range []string{"/api/prompts", "/api/prompts/sweep"} {
			resp := s.do(t, as, http.MethodGet, path, "")
			resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("GET %s as %s: status %d, want 200", path, as, resp.StatusCode)
			}
		}
	}
	for _, as := range []string{"cairnPhone", "mill"} {
		if status, _ := s.putPrompt(t, as, "other", sweepPrompt); status != http.StatusForbidden {
			t.Fatalf("PUT as %s: status %d, want 403", as, status)
		}
		resp := s.do(t, as, http.MethodDelete, "/api/prompts/sweep", "")
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("DELETE as %s: status %d, want 403", as, resp.StatusCode)
		}
	}
	// the refused writes changed nothing
	resp := s.do(t, "governor", http.MethodGet, "/api/prompts/other", "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("a refused PUT stored a prompt: status %d", resp.StatusCode)
	}
	resp = s.do(t, "governor", http.MethodGet, "/api/prompts/sweep", "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("a refused DELETE removed the prompt: status %d", resp.StatusCode)
	}
}

const laterPrompt = `{"name":"later","summary":"Park a want","signature":[{"flag":"--text","type":"text","required":true}],"body":"Park <text>."}`

// A prompt may take one free-text option, the words no flag takes (docs/protocol.md section 23).
func TestAPromptWithOneTextOptionIsSavedAndTwoAreRefused(t *testing.T) {
	s := newPromptsServer(t)
	if status, body := s.putPrompt(t, "governor", "later", laterPrompt); status != http.StatusOK {
		t.Fatalf("PUT with one text option: status %d (%s), want 200", status, body)
	}
	resp := s.do(t, "governor", http.MethodGet, "/api/prompts/later", "")
	defer resp.Body.Close()
	var got prompts.Prompt
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil || len(got.Signature) != 1 || got.Signature[0].Type != "text" || !got.Signature[0].Required {
		t.Fatalf("stored prompt = %+v (%v), want the text option kept", got, err)
	}

	two := `{"signature":[{"flag":"--text","type":"text"},{"flag":"--more","type":"text"}]}`
	status, body := s.putPrompt(t, "governor", "twice", two)
	if status != http.StatusBadRequest {
		t.Fatalf("PUT with two text options: status %d (%s), want 400", status, body)
	}
	var out struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal([]byte(body), &out); err != nil || !strings.Contains(out.Error, "free-text") || strings.Contains(out.Error, "\n") {
		t.Fatalf("body %q is not a one-line {error} naming the free-text rule", body)
	}
}

func TestABadPromptIsA400WithAOneLineReason(t *testing.T) {
	s := newPromptsServer(t)
	cases := []struct{ why, name, body string }{
		{"bad name in the path", "Bad_Name", sweepPrompt},
		{"flag without --", "sweep", `{"signature":[{"flag":"duration","type":"duration"}]}`},
		{"unparseable default", "sweep", `{"signature":[{"flag":"--duration","type":"duration","default":"soon"}]}`},
		{"unknown type", "sweep", `{"signature":[{"flag":"--n","type":"float"}]}`},
		{"body names another prompt", "sweep", `{"name":"other"}`},
		{"not json", "sweep", `{nope`},
	}
	for _, tc := range cases {
		t.Run(tc.why, func(t *testing.T) {
			status, body := s.putPrompt(t, "governor", tc.name, tc.body)
			if status != http.StatusBadRequest {
				t.Fatalf("status %d (%s), want 400", status, body)
			}
			var out struct {
				Error string `json:"error"`
			}
			if err := json.Unmarshal([]byte(body), &out); err != nil || out.Error == "" || strings.Contains(out.Error, "\n") {
				t.Fatalf("body %q is not a one-line {error}", body)
			}
		})
	}
	resp := s.do(t, "governor", http.MethodGet, "/api/prompts", "")
	defer resp.Body.Close()
	var list []prompts.Prompt
	json.NewDecoder(resp.Body).Decode(&list)
	if len(list) != 0 {
		t.Fatalf("a bad PUT stored %d prompts", len(list))
	}
}

func TestDeleteThenGetIs404(t *testing.T) {
	s := newPromptsServer(t)
	s.putPrompt(t, "governor", "sweep", sweepPrompt)
	resp := s.do(t, "governor", http.MethodDelete, "/api/prompts/sweep", "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("DELETE: status %d, want 204", resp.StatusCode)
	}
	resp = s.do(t, "governor", http.MethodGet, "/api/prompts/sweep", "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("GET after DELETE: status %d, want 404", resp.StatusCode)
	}
	resp = s.do(t, "governor", http.MethodDelete, "/api/prompts/sweep", "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("second DELETE: status %d, want 404", resp.StatusCode)
	}
}

func TestTheListIsEmptyAtFirstAndSortedByName(t *testing.T) {
	s := newPromptsServer(t)
	list := func() []prompts.Prompt {
		resp := s.do(t, "cairnPhone", http.MethodGet, "/api/prompts", "")
		defer resp.Body.Close()
		var raw json.RawMessage
		if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
			t.Fatalf("decoding: %v", err)
		}
		if strings.TrimSpace(string(raw)) == "null" {
			t.Fatalf("the list is null, want []")
		}
		var out []prompts.Prompt
		json.Unmarshal(raw, &out)
		return out
	}
	if got := list(); len(got) != 0 {
		t.Fatalf("fresh list = %+v", got)
	}
	s.putPrompt(t, "governor", "zeta", `{}`)
	s.putPrompt(t, "governor", "alpha", `{}`)
	got := list()
	if len(got) != 2 || got[0].Name != "alpha" || got[1].Name != "zeta" {
		t.Fatalf("list = %+v", got)
	}
}

func TestTheListCarriesAnETagAndAMatchingIfNoneMatchIs304(t *testing.T) {
	s := newPromptsServer(t)
	s.putPrompt(t, "governor", "sweep", sweepPrompt)

	first := s.do(t, "cairnPhone", http.MethodGet, "/api/prompts", "")
	first.Body.Close()
	etag := first.Header.Get("ETag")
	if first.StatusCode != http.StatusOK || etag == "" {
		t.Fatalf("GET /api/prompts: status %d, ETag %q", first.StatusCode, etag)
	}

	again := func(match string) *http.Response {
		priv, _ := s.v.key(t, "cairnPhone")
		req, _ := http.NewRequest(http.MethodGet, s.URL+"/api/prompts", nil)
		req.Header = authorizedAs(t, s.Server, priv)
		req.Header.Set("If-None-Match", match)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("request: %v", err)
		}
		resp.Body.Close()
		return resp
	}
	if resp := again(etag); resp.StatusCode != http.StatusNotModified || resp.Header.Get("ETag") != etag {
		t.Fatalf("matching If-None-Match: status %d, ETag %q, want 304 and %q", resp.StatusCode, resp.Header.Get("ETag"), etag)
	}
	if resp := again(`W/` + etag + `, "other"`); resp.StatusCode != http.StatusNotModified {
		t.Fatalf("weak/listed If-None-Match: status %d, want 304", resp.StatusCode)
	}
	if resp := again(`"stale"`); resp.StatusCode != http.StatusOK {
		t.Fatalf("stale If-None-Match: status %d, want 200", resp.StatusCode)
	}

	// a change moves the ETag
	s.putPrompt(t, "governor", "sweep", `{"summary":"new"}`)
	if resp := again(etag); resp.StatusCode != http.StatusOK || resp.Header.Get("ETag") == etag {
		t.Fatalf("after a PUT: status %d, ETag %q, want 200 and a new tag", resp.StatusCode, resp.Header.Get("ETag"))
	}
}
