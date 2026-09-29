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
	"github.com/Jonathan-A-White/postern/server/internal/record"
	"github.com/Jonathan-A-White/postern/server/internal/standby"
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
// one notify.Fanout (web push, the event hub, the on-message hook, the
// on-grist hook) that both the poller and direct delivery tell about each
// newly indexed record. A grist for the mill wakes the on-grist hook and
// never the on-message hook (docs/protocol.md §19).
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

	var home *standby.Monitor
	if cfg.HomeCmd != "" {
		home = standby.New(cfg.HomeCmd)
		home.Check()
		log.Printf("home command: %s (standby=%v)", cfg.HomeCmd, home.Standby())
	}

	hub := events.NewHub()
	fanout := buildFanout(cfg, home, sender, hub)
	if cfg.MillKey != "" {
		log.Printf("grist: mill %s, apps %v", cfg.MillKey, cfg.Apps)
	}
	viewFile := view.New(cfg.ViewFile)

	if cfg.IssuerKey == "" {
		log.Printf("warning: POSTERN_ISSUER_KEY is not set, so any mint naming a key in %s licenses it, self-minted or not", strings.Join(cfg.Collections, ", "))
	}
	collections := append([]string{}, cfg.Collections...)
	for collection := range cfg.Apps {
		collections = append(collections, collection)
	}
	rule := licence.Rule{Collections: collections, IssuerKey: cfg.IssuerKey}
	licenceChecker := auth.NewCachedChecker(client, licenceCacheTTL, auth.WithRule(rule))

	handler := api.NewHandler(store, client, vapidKeys.PublicKey, pushStore, blobStore, auth.NewNonceStore(nonceTTL), licenceChecker,
		api.WithNotifier(fanout),
		api.WithEvents(hub, api.DefaultPingInterval),
		api.WithView(viewFile),
		api.WithBeads(beads.New(cfg.BeadCmd)),
		api.WithIdentity(cfg.MayorKey, cfg.Network),
		api.WithGrist(cfg.MillKey, cfg.Apps),
		api.WithCORS(cfg.CORSOrigins),
	)

	start := func(stop <-chan struct{}) {
		if err := blobStore.Sweep(time.Now()); err != nil {
			log.Printf("sweeping blob store: %v", err)
		}
		go poller.New(client, store, cfg.Anchor, poller.WithNotifier(fanout)).Run(stop)
		go runBlobSweep(blobStore, stop)
		go home.Run(stop, standby.DefaultInterval)
		if cfg.ViewFile != "" {
			go viewFile.Watch(stop, view.DefaultWatchInterval, hub.ViewChanged)
		}
	}

	return &app{handler: standby.Middleware(home, handler), start: start, close: func() { store.Close() }}, nil
}

// buildFanout is the one fan-out for "a record was indexed": web push (silent
// while this host is in standby), the event hub, the on-message hook when
// configured (which runs in standby too: mw decides what to apply) for every
// record but grist for the mill, and the on-grist hook for that grist.
func buildFanout(cfg config.Config, home *standby.Monitor, pusher, hub notify.Notifier) notify.Fanout {
	fanout := notify.Fanout{standby.Gate(home, pusher), hub}
	forMill := gristForMill(cfg.MillKey)
	if cfg.OnMessage != "" {
		fanout = append(fanout, notify.Only{Notifier: hook.New(cfg.OnMessage), Keep: func(rec index.Record) bool { return !forMill(rec) }})
		log.Printf("on-message hook: %s", cfg.OnMessage)
	}
	if cfg.OnGrist != "" {
		fanout = append(fanout, notify.Only{Notifier: hook.New(cfg.OnGrist), Keep: forMill})
		log.Printf("on-grist hook: %s", cfg.OnGrist)
	}
	return fanout
}

// gristForMill reports whether a record is a grist addressed to millKey
// (docs/protocol.md §19); with no mill key, nothing is.
func gristForMill(millKey string) func(rec index.Record) bool {
	return func(rec index.Record) bool {
		if millKey == "" {
			return false
		}
		env, err := record.ParseEnvelope(rec.Payload)
		return err == nil && env.Class == record.ClassGrist && strings.EqualFold(env.To, millKey)
	}
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
