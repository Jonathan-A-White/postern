package main

import (
	"strings"
	"testing"

	"github.com/Jonathan-A-White/postern/server/internal/config"
)

func registrationConfig(t *testing.T, env map[string]string) config.Config {
	t.Helper()
	base := map[string]string{
		"POSTERN_ANCHOR":   "mt6vaAWeFxu2qC6pPs7bsqTNvv87dCwMW5",
		"POSTERN_DATA":     t.TempDir(),
		"POSTERN_WOC_BASE": "http://unused.invalid",
		"POSTERN_HOME_CMD": "exit 0",
	}
	for k, v := range env {
		base[k] = v
	}
	cfg, err := config.Load(func(key string) string { return base[key] })
	if err != nil {
		t.Fatalf("config.Load: %v", err)
	}
	return cfg
}

// AC5 (mw-cvwm1u.9): with Twilio set and POSTERN_REGISTER_IP_HEADER not,
// every caller behind nginx shares one per-IP bucket, so the backend says so
// once at start; with the header set, or registration closed, it says nothing.
func TestTwilioWithoutTheIPHeaderWarnsOnceAtStart(t *testing.T) {
	twilio := map[string]string{
		"POSTERN_TWILIO_ACCOUNT_SID": "ACtest",
		"POSTERN_TWILIO_AUTH_TOKEN":  "token",
		"POSTERN_TWILIO_VERIFY_SID":  "VAtest",
	}
	withHeader := map[string]string{"POSTERN_REGISTER_IP_HEADER": "X-Real-IP"}
	for k, v := range twilio {
		withHeader[k] = v
	}
	for _, tc := range []struct {
		name  string
		env   map[string]string
		lines int
	}{
		{"twilio, no header", twilio, 1},
		{"twilio and the header", withHeader, 0},
		{"no twilio", nil, 0},
	} {
		logged := captureLog(t)
		app, err := newApp(registrationConfig(t, tc.env))
		if err != nil {
			t.Fatalf("%s: newApp: %v", tc.name, err)
		}
		app.close()
		var warnings []string
		for _, line := range strings.Split(logged(), "\n") {
			if strings.Contains(line, "warning") && strings.Contains(line, "POSTERN_REGISTER_IP_HEADER") {
				warnings = append(warnings, line)
			}
		}
		if len(warnings) != tc.lines {
			t.Errorf("%s: %d warning lines naming POSTERN_REGISTER_IP_HEADER, want %d:\n%s", tc.name, len(warnings), tc.lines, logged())
		}
	}
}

// The global send cap is a knob that reaches registration.
func TestTheSendCapReachesRegistration(t *testing.T) {
	cfg := registrationConfig(t, map[string]string{"POSTERN_REGISTER_SENDS_PER_HOUR": "7"})
	if cfg.RegisterSendsPerHour != 7 {
		t.Fatalf("RegisterSendsPerHour = %d, want 7", cfg.RegisterSendsPerHour)
	}
	svc, err := newRegistration(cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := svc.SendsPerHour(); got != 7 {
		t.Fatalf("the service's send cap = %d, want 7", got)
	}
}
