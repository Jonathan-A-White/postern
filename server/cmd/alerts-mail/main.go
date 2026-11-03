// Command alerts-mail is the alerts mail receiver (docs/alerts-mail.md): an
// SMTP listener for the alerts domain that takes mail only for a family's
// address token, reads each mail in memory into parsed facts, posts them to
// the backend's POST /api/alerts/inbound (docs/protocol.md §26) and keeps no
// mail.
//
// It is configured from the environment:
//
//	POSTERN_ALERTS_DOMAIN          the alerts mail domain (required)
//	POSTERN_ALERTS_SECRET          the shared secret the backend expects (required)
//	POSTERN_ALERTS_MAIL_BACKEND    the backend's base URL (default http://127.0.0.1:8787)
//	POSTERN_ALERTS_MAIL_ADDR       where to listen (default :25)
//	POSTERN_ALERTS_MAIL_HOSTNAME   the name it greets with (default the domain)
//	POSTERN_ALERTS_MAIL_TLS_CERT   a PEM certificate chain; with the key, STARTTLS is offered
//	POSTERN_ALERTS_MAIL_TLS_KEY    its PEM private key
package main

import (
	"crypto/tls"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/alertsmail"
	"github.com/emersion/go-smtp"
)

const (
	defaultBackend = "http://127.0.0.1:8787"
	defaultAddr    = ":25"
)

type config struct {
	domain, secret, backend, addr, hostname, certFile, keyFile string
}

func readConfig(getenv func(string) string) (config, error) {
	get := func(name string) string { return strings.TrimSpace(getenv(name)) }
	cfg := config{
		domain:   strings.ToLower(get("POSTERN_ALERTS_DOMAIN")),
		secret:   get("POSTERN_ALERTS_SECRET"),
		backend:  get("POSTERN_ALERTS_MAIL_BACKEND"),
		addr:     get("POSTERN_ALERTS_MAIL_ADDR"),
		hostname: get("POSTERN_ALERTS_MAIL_HOSTNAME"),
		certFile: get("POSTERN_ALERTS_MAIL_TLS_CERT"),
		keyFile:  get("POSTERN_ALERTS_MAIL_TLS_KEY"),
	}
	if cfg.domain == "" || strings.ContainsAny(cfg.domain, "@/ ") {
		return config{}, errors.New("POSTERN_ALERTS_DOMAIN must be the alerts mail domain, like alerts.example.org")
	}
	if cfg.secret == "" {
		return config{}, errors.New("POSTERN_ALERTS_SECRET must be set: the backend refuses inbound alerts without it")
	}
	if cfg.backend == "" {
		cfg.backend = defaultBackend
	}
	if u, err := url.Parse(cfg.backend); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return config{}, fmt.Errorf("POSTERN_ALERTS_MAIL_BACKEND must be an http(s) URL, not %q", cfg.backend)
	}
	if cfg.addr == "" {
		cfg.addr = defaultAddr
	}
	if cfg.hostname == "" {
		cfg.hostname = cfg.domain
	}
	if (cfg.certFile == "") != (cfg.keyFile == "") {
		return config{}, errors.New("POSTERN_ALERTS_MAIL_TLS_CERT and POSTERN_ALERTS_MAIL_TLS_KEY are set together or not at all")
	}
	return cfg, nil
}

// certReloader reads the certificate again when its file changes, so a
// renewed certificate is used without a restart.
type certReloader struct {
	certFile, keyFile string
	mu                sync.Mutex
	loaded            time.Time
	cert              *tls.Certificate
}

func (c *certReloader) get(*tls.ClientHelloInfo) (*tls.Certificate, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	info, err := os.Stat(c.certFile)
	if err == nil && c.cert != nil && !info.ModTime().After(c.loaded) {
		return c.cert, nil
	}
	cert, err := tls.LoadX509KeyPair(c.certFile, c.keyFile)
	if err != nil {
		if c.cert != nil {
			log.Printf("alerts-mail: reloading the certificate: %v; keeping the one loaded", err)
			return c.cert, nil
		}
		return nil, err
	}
	c.cert, c.loaded = &cert, time.Now()
	if info != nil {
		c.loaded = info.ModTime()
	}
	return c.cert, nil
}

func run() error {
	cfg, err := readConfig(os.Getenv)
	if err != nil {
		return err
	}
	var tlsConfig *tls.Config
	if cfg.certFile != "" {
		certs := &certReloader{certFile: cfg.certFile, keyFile: cfg.keyFile}
		if _, err := certs.get(nil); err != nil {
			return fmt.Errorf("loading the certificate: %w", err)
		}
		tlsConfig = &tls.Config{GetCertificate: certs.get, MinVersion: tls.VersionTLS12}
	}
	srv := alertsmail.NewServer(alertsmail.Config{
		Domain:   cfg.domain,
		Hostname: cfg.hostname,
		Inbound: &alertsmail.HTTPInbound{
			URL:    cfg.backend,
			Secret: cfg.secret,
			Client: &http.Client{Timeout: 20 * time.Second},
		},
		TLS: tlsConfig,
	})
	srv.Addr = cfg.addr

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-stop
		_ = srv.Close()
	}()
	log.Printf("alerts-mail: taking mail for %s on %s (STARTTLS %v)", cfg.domain, cfg.addr, tlsConfig != nil)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, smtp.ErrServerClosed) {
		return err
	}
	return nil
}

func main() {
	if err := run(); err != nil {
		log.Fatalf("alerts-mail: %v", err)
	}
}
