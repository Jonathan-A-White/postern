package prompts

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func sample(name string) Prompt {
	return Prompt{
		Name:    name,
		Summary: "Do a thing",
		Signature: []Option{
			{Flag: "--duration", Type: TypeDuration, Default: "30m", Help: "how long"},
			{Flag: "--who", Type: TypeString, Required: true},
		},
		Body:      "Do the thing for {{duration}}.",
		UpdatedAt: time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC),
		UpdatedBy: "02abc",
	}
}

func TestAPutPersistsAcrossReopenAndRoundTripsTheSignature(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenStore(dir)
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	if err := store.Put(sample("sweep")); err != nil {
		t.Fatalf("Put: %v", err)
	}

	again, err := OpenStore(dir)
	if err != nil {
		t.Fatalf("reopening: %v", err)
	}
	got, ok := again.Get("sweep")
	if !ok {
		t.Fatalf("Get after reopen: not found")
	}
	if len(got.Signature) != 2 || got.Signature[0].Flag != "--duration" || got.Signature[0].Default != "30m" || !got.Signature[1].Required {
		t.Fatalf("signature did not round-trip: %+v", got.Signature)
	}
	if _, err := os.Stat(filepath.Join(dir, "prompts.json")); err != nil {
		t.Fatalf("prompts.json not written: %v", err)
	}
	if left, _ := filepath.Glob(filepath.Join(dir, "*.tmp")); len(left) != 0 {
		t.Fatalf("temp files left behind: %v", left)
	}
}

func TestListIsSortedByNameAndNeverNil(t *testing.T) {
	store, _ := OpenStore(t.TempDir())
	if got := store.List(); got == nil || len(got) != 0 {
		t.Fatalf("empty list = %#v, want a non-nil empty slice", got)
	}
	for _, name := range []string{"zeta", "alpha", "mid-1"} {
		if err := store.Put(sample(name)); err != nil {
			t.Fatalf("Put %s: %v", name, err)
		}
	}
	var names []string
	for _, p := range store.List() {
		names = append(names, p.Name)
	}
	if strings.Join(names, ",") != "alpha,mid-1,zeta" {
		t.Fatalf("names = %v", names)
	}
}

func TestPutReplacesAndDeleteRemoves(t *testing.T) {
	store, _ := OpenStore(t.TempDir())
	store.Put(sample("sweep"))
	changed := sample("sweep")
	changed.Summary = "changed"
	store.Put(changed)
	if got, _ := store.Get("sweep"); got.Summary != "changed" || len(store.List()) != 1 {
		t.Fatalf("Put did not replace: %+v", store.List())
	}
	existed, err := store.Delete("sweep")
	if err != nil || !existed {
		t.Fatalf("Delete = %v, %v", existed, err)
	}
	if _, ok := store.Get("sweep"); ok {
		t.Fatalf("still there after Delete")
	}
	if existed, _ := store.Delete("sweep"); existed {
		t.Fatalf("second Delete reported it existed")
	}
}

func TestACorruptFileIsAnError(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "prompts.json"), []byte("{nope"), 0o600)
	if _, err := OpenStore(dir); err == nil {
		t.Fatalf("OpenStore accepted a corrupt prompts.json")
	}
}

func TestValidate(t *testing.T) {
	cases := []struct {
		why    string
		mutate func(*Prompt)
		bad    string // substring of the reason, "" if valid
	}{
		{"valid", func(p *Prompt) {}, ""},
		{"empty name", func(p *Prompt) { p.Name = "" }, "name"},
		{"upper-case name", func(p *Prompt) { p.Name = "Sweep" }, "name"},
		{"underscore name", func(p *Prompt) { p.Name = "a_b" }, "name"},
		{"33 char name", func(p *Prompt) { p.Name = strings.Repeat("a", 33) }, "name"},
		{"32 char name", func(p *Prompt) { p.Name = strings.Repeat("a", 32) }, ""},
		{"flag without dashes", func(p *Prompt) { p.Signature[0].Flag = "duration" }, "--"},
		{"single dash flag", func(p *Prompt) { p.Signature[0].Flag = "-d" }, "--"},
		{"bare dashes flag", func(p *Prompt) { p.Signature[0].Flag = "--" }, "--"},
		{"duplicate flag", func(p *Prompt) { p.Signature[1].Flag = "--duration" }, "twice"},
		{"unknown type", func(p *Prompt) { p.Signature[0].Type = "float" }, "type"},
		{"unparseable duration default", func(p *Prompt) { p.Signature[0].Default = "soon" }, "default"},
		{"unparseable int default", func(p *Prompt) { p.Signature[0].Type = TypeInt; p.Signature[0].Default = "1.5" }, "default"},
		{"int default", func(p *Prompt) { p.Signature[0].Type = TypeInt; p.Signature[0].Default = "7" }, ""},
		{"unparseable bool default", func(p *Prompt) { p.Signature[0].Type = TypeBool; p.Signature[0].Default = "maybe" }, "default"},
		{"bool default", func(p *Prompt) { p.Signature[0].Type = TypeBool; p.Signature[0].Default = "true" }, ""},
		{"empty default is none", func(p *Prompt) { p.Signature[0].Default = "" }, ""},
		{"any string default", func(p *Prompt) { p.Signature[1].Default = "anything at all" }, ""},
	}
	for _, tc := range cases {
		t.Run(tc.why, func(t *testing.T) {
			p := sample("sweep")
			tc.mutate(&p)
			err := p.Validate()
			switch {
			case tc.bad == "" && err != nil:
				t.Fatalf("Validate = %v, want nil", err)
			case tc.bad != "" && err == nil:
				t.Fatalf("Validate = nil, want a reason mentioning %q", tc.bad)
			case tc.bad != "" && !strings.Contains(err.Error(), tc.bad):
				t.Fatalf("Validate = %q, want it to mention %q", err, tc.bad)
			case err != nil && strings.Contains(err.Error(), "\n"):
				t.Fatalf("reason is not one line: %q", err)
			}
		})
	}
}

func TestOneTextOptionIsValidWithAnyDefaultAndTwoAreNot(t *testing.T) {
	p := sample("later")
	p.Signature = []Option{{Flag: "--text", Type: TypeText, Default: "anything at all: 12?", Required: false}}
	if err := p.Validate(); err != nil {
		t.Fatalf("one text option: %v", err)
	}
	p.Signature = append(p.Signature, Option{Flag: "--more", Type: TypeText})
	err := p.Validate()
	if err == nil || !strings.Contains(err.Error(), "free-text") || strings.Contains(err.Error(), "\n") {
		t.Fatalf("two text options: got %v, want a one-line free-text refusal", err)
	}
}
