package record

import (
	"strings"
	"testing"
)

// vector1 is docs/protocol.md §5's Vector 1 payload, byte for byte the
// shape the PWA sends.
const vector1 = `{"v":1,"kind":"msg","class":"message","to":"029cbf013d04ca50ba852816c2802b06ca5ed37b44be9597fc0f95360e209afa97","from":"039d1abaec9f5715a15c7628244170951e0f85e87f68ca5393d3f9fc3fa23a69c8","ts":1758700000,"ct":"QkIQMwOdGrrsn1cVoVx2KCRBcJUeD4Xof2jKU5PT+fw/ojppyAKcvwE9BMpQuoUoFsKAKwbKXtN7RL6Vl/wPlTYOIJr6ly29yXkTykfSVSTrUVnERI/lCUsFLuvVhgyN79hFczet0W67HhaxJRMUSM/BXPUDPdFB/gQbllS0XYOgVPldzejkyjylJbipQqP4YgfBX9ZMXE8wgY4FS6wVF6bMvLwC4WA0bupV8apiP8jK9Q=="}`

func TestParseEnvelopeAcceptsProtocolVector1(t *testing.T) {
	env, err := ParseEnvelope([]byte(vector1))
	if err != nil {
		t.Fatalf("ParseEnvelope: %v", err)
	}
	if env.Class != "message" {
		t.Fatalf("Class = %q, want message", env.Class)
	}
	if env.To != "029cbf013d04ca50ba852816c2802b06ca5ed37b44be9597fc0f95360e209afa97" {
		t.Fatalf("To = %q", env.To)
	}
	if env.From != "039d1abaec9f5715a15c7628244170951e0f85e87f68ca5393d3f9fc3fa23a69c8" {
		t.Fatalf("From = %q", env.From)
	}
}

func TestParseEnvelopeAcceptsEveryKnownClass(t *testing.T) {
	for _, class := range []string{"message", "decision-needed", "landing", "alarm", "move-home", "grist", "talk", "call"} {
		payload := strings.Replace(vector1, `"class":"message"`, `"class":"`+class+`"`, 1)
		if _, err := ParseEnvelope([]byte(payload)); err != nil {
			t.Fatalf("class %q: %v", class, err)
		}
	}
}

func TestParseEnvelopeRejectsAnythingElse(t *testing.T) {
	for _, tc := range []struct{ name, from, to string }{
		{"not json", vector1, "not json"},
		{"not an object", vector1, `[1,2]`},
		{"v is 2", `"v":1`, `"v":2`},
		{"v is a string", `"v":1`, `"v":"1"`},
		{"v missing", `"v":1,`, ``},
		{"kind is not msg", `"kind":"msg"`, `"kind":"mint"`},
		{"unknown class", `"class":"message"`, `"class":"gossip"`},
		{"class missing", `"class":"message",`, ``},
		{"to too short", `"to":"029cbf`, `"to":"9cbf`},
		{"to not hex", `"to":"029cbf`, `"to":"zz9cbf`},
		{"from missing", `"from":"039d1abaec9f5715a15c7628244170951e0f85e87f68ca5393d3f9fc3fa23a69c8",`, ``},
		{"ts is a string", `"ts":1758700000`, `"ts":"1758700000"`},
		{"ts missing", `"ts":1758700000,`, ``},
		{"ct is a number", `"ct":"QkIQ`, `"ct":5,"x":"QkIQ`},
		{"ct missing", `,"ct":"QkIQ`, `,"x":"QkIQ`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			payload := strings.Replace(vector1, tc.from, tc.to, 1)
			if payload == vector1 && tc.name != "not json" {
				t.Fatalf("test case %q did not change the payload", tc.name)
			}
			if tc.name == "not json" {
				payload = tc.to
			}
			if _, err := ParseEnvelope([]byte(payload)); err == nil {
				t.Fatalf("ParseEnvelope accepted %s", payload)
			}
		})
	}
}
