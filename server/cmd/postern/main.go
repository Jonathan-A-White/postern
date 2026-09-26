package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/api"
	"github.com/Jonathan-A-White/postern/server/internal/auth"
	"github.com/Jonathan-A-White/postern/server/internal/config"
	"github.com/Jonathan-A-White/postern/server/internal/index"
	"github.com/Jonathan-A-White/postern/server/internal/poller"
	"github.com/Jonathan-A-White/postern/server/internal/push"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
)

// nonceTTL is how long a GET /api/challenge nonce may be used before it
// expires unconsumed. licenceCacheTTL is how long a key's licence check is
// cached before the chain is walked again.
const (
	nonceTTL        = 2 * time.Minute
	licenceCacheTTL = 5 * time.Minute
)

func main() {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		log.Fatalf("loading config: %v", err)
	}

	store, err := index.Open(cfg.DataDir)
	if err != nil {
		log.Fatalf("opening index: %v", err)
	}
	defer store.Close()

	client := woc.NewClient(cfg.WocBase)

	vapidKeys, err := push.LoadOrGenerateVAPIDKeys(cfg.DataDir, cfg.VAPIDPublicKey, cfg.VAPIDPrivateKey)
	if err != nil {
		log.Fatalf("loading VAPID keys: %v", err)
	}
	pushStore, err := push.OpenStore(cfg.DataDir)
	if err != nil {
		log.Fatalf("opening push subscription store: %v", err)
	}
	sender := push.NewSender(vapidKeys, cfg.PushSubscriber, pushStore)

	p := poller.New(client, store, cfg.Anchor, poller.WithNotifier(sender))
	stop := make(chan struct{})
	defer close(stop)
	go p.Run(stop)

	nonces := auth.NewNonceStore(nonceTTL)
	licenceChecker := auth.NewCachedChecker(client, licenceCacheTTL)
	handler := api.NewHandler(store, client, vapidKeys.PublicKey, pushStore, nonces, licenceChecker)

	log.Printf("postern server listening on %s (network=%s, anchor=%s, woc=%s)", cfg.Addr, cfg.Network, cfg.Anchor, cfg.WocBase)
	if err := http.ListenAndServe(cfg.Addr, handler); err != nil {
		log.Fatal(err)
	}
}
