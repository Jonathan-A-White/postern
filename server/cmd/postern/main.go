package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/api"
	"github.com/Jonathan-A-White/postern/server/internal/auth"
	"github.com/Jonathan-A-White/postern/server/internal/beads"
	"github.com/Jonathan-A-White/postern/server/internal/blobs"
	"github.com/Jonathan-A-White/postern/server/internal/config"
	"github.com/Jonathan-A-White/postern/server/internal/events"
	"github.com/Jonathan-A-White/postern/server/internal/hook"
	"github.com/Jonathan-A-White/postern/server/internal/index"
	"github.com/Jonathan-A-White/postern/server/internal/licence"
	"github.com/Jonathan-A-White/postern/server/internal/notify"
	"github.com/Jonathan-A-White/postern/server/internal/poller"
	"github.com/Jonathan-A-White/postern/server/internal/push"
	"github.com/Jonathan-A-White/postern/server/internal/view"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
)

// nonceTTL is how long a GET /api/challenge nonce may be used before it
// expires unconsumed. licenceCacheTTL is how long a key's licence check is
// cached before the chain is walked again. blobSweepInterval is how often
// the blob store is swept for expired attachments, beside the sweep run
// once at start.
const (
	nonceTTL          = 2 * time.Minute
	licenceCacheTTL   = 5 * time.Minute
	blobSweepInterval = time.Hour
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "watchdog" {
		os.Exit(runWatchdog(os.Getenv, log.Printf))
	}

	cfg, err := config.Load(os.Getenv)
	if err != nil {
		log.Fatalf("loading config: %v", err)
	}

	app, err := newApp(cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer app.close()

	stop := make(chan struct{})
	defer close(stop)
	app.start(stop)

	log.Printf("postern server listening on %s (network=%s, anchor=%s, woc=%s)", cfg.Addr, cfg.Network, cfg.Anchor, cfg.WocBase)
	if err := http.ListenAndServe(cfg.Addr, app.handler); err != nil {
		log.Fatal(err)
	}
}

// app is the assembled backend: its HTTP handler, the background loops
// start runs, and close to release the index.
type app struct {
	handler http.Handler
	start   func(stop <-chan struct{})
	close   func()
}

// newApp opens the stores and wires every part of the backend together:
// one notify.Fanout (web push, the event hub, the on-message hook) that
// both the poller and direct delivery tell about each newly indexed record.
func newApp(cfg config.Config) (*app, error) {
	store, err := index.Open(cfg.DataDir)
	if err != nil {
		return nil, fmt.Errorf("opening index: %w", err)
	}

	client := woc.NewClient(cfg.WocBase)

	vapidKeys, err := push.LoadOrGenerateVAPIDKeys(cfg.DataDir, cfg.VAPIDPublicKey, cfg.VAPIDPrivateKey)
	if err != nil {
		store.Close()
		return nil, fmt.Errorf("loading VAPID keys: %w", err)
	}
	pushStore, err := push.OpenStore(cfg.DataDir)
	if err != nil {
		store.Close()
		return nil, fmt.Errorf("opening push subscription store: %w", err)
	}
	sender := push.NewSender(vapidKeys, cfg.PushSubscriber, pushStore)

	blobStore, err := blobs.OpenStore(cfg.DataDir)
	if err != nil {
		store.Close()
		return nil, fmt.Errorf("opening blob store: %w", err)
	}

	hub := events.NewHub()
	fanout := notify.Fanout{sender, hub}
	if cfg.OnMessage != "" {
		fanout = append(fanout, hook.New(cfg.OnMessage))
		log.Printf("on-message hook: %s", cfg.OnMessage)
	}
	viewFile := view.New(cfg.ViewFile)

	if cfg.IssuerKey == "" {
		log.Printf("warning: POSTERN_ISSUER_KEY is not set, so any mint naming a key in %s licenses it, self-minted or not", strings.Join(cfg.Collections, ", "))
	}
	rule := licence.Rule{Collections: cfg.Collections, IssuerKey: cfg.IssuerKey}
	licenceChecker := auth.NewCachedChecker(client, licenceCacheTTL, auth.WithRule(rule))

	handler := api.NewHandler(store, client, vapidKeys.PublicKey, pushStore, blobStore, auth.NewNonceStore(nonceTTL), licenceChecker,
		api.WithNotifier(fanout),
		api.WithEvents(hub, api.DefaultPingInterval),
		api.WithView(viewFile),
		api.WithBeads(beads.New(cfg.BeadCmd)),
		api.WithIdentity(cfg.MayorKey, cfg.Network),
	)

	start := func(stop <-chan struct{}) {
		if err := blobStore.Sweep(time.Now()); err != nil {
			log.Printf("sweeping blob store: %v", err)
		}
		go poller.New(client, store, cfg.Anchor, poller.WithNotifier(fanout)).Run(stop)
		go runBlobSweep(blobStore, stop)
		if cfg.ViewFile != "" {
			go viewFile.Watch(stop, view.DefaultWatchInterval, hub.ViewChanged)
		}
	}

	return &app{handler: handler, start: start, close: func() { store.Close() }}, nil
}

// runBlobSweep runs store.Sweep on blobSweepInterval until stop is closed
// (an initial sweep already ran once at start, before this goroutine
// starts).
func runBlobSweep(store *blobs.Store, stop <-chan struct{}) {
	ticker := time.NewTicker(blobSweepInterval)
	defer ticker.Stop()

	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			if err := store.Sweep(time.Now()); err != nil {
				log.Printf("sweeping blob store: %v", err)
			}
		}
	}
}
