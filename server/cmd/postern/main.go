package main

import (
	"log"
	"net/http"
	"os"

	"github.com/Jonathan-A-White/postern/server/internal/api"
	"github.com/Jonathan-A-White/postern/server/internal/config"
	"github.com/Jonathan-A-White/postern/server/internal/index"
	"github.com/Jonathan-A-White/postern/server/internal/poller"
	"github.com/Jonathan-A-White/postern/server/internal/push"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
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

	handler := api.NewHandler(store, client, vapidKeys.PublicKey, pushStore)

	log.Printf("postern server listening on %s (network=%s, anchor=%s, woc=%s)", cfg.Addr, cfg.Network, cfg.Anchor, cfg.WocBase)
	if err := http.ListenAndServe(cfg.Addr, handler); err != nil {
		log.Fatal(err)
	}
}
