package main

import (
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/push"
	"github.com/Jonathan-A-White/postern/server/internal/watchdog"
)

// runWatchdog is `postern watchdog` (see internal/watchdog): one check of
// POSTERN_WATCH_URL, alarms pushed with the desktop's VAPID keys and
// subscriptions copied into POSTERN_DATA. It returns the process's exit
// code: 0 whatever the target's state, non-zero only for a config fault (no
// URL, no push keys, an unusable data directory).
func runWatchdog(getenv func(string) string, logf func(format string, args ...any)) int {
	cfg, err := watchdog.LoadConfig(getenv)
	if err != nil {
		logf("watchdog: %v", err)
		return 2
	}
	keys, err := push.LoadVAPIDKeys(cfg.DataDir, getenv("POSTERN_VAPID_PUBLIC_KEY"), getenv("POSTERN_VAPID_PRIVATE_KEY"))
	if err != nil {
		logf("watchdog: loading push keys (copy postern-vapid.json from the desktop into POSTERN_DATA): %v", err)
		return 2
	}
	subscriptions, err := push.OpenStore(cfg.DataDir)
	if err != nil {
		logf("watchdog: loading push subscriptions: %v", err)
		return 2
	}
	sender := push.NewSender(keys, cfg.Subscriber, subscriptions)

	err = watchdog.Run(cfg, watchdog.Deps{
		Now:   time.Now,
		Check: watchdog.HTTPCheck(watchdog.CheckTimeout),
		Notify: func(a watchdog.Alarm) (int, error) {
			return sender.Broadcast(push.Payload{Class: a.Class, Title: a.Title, Body: a.Body, Ts: a.Ts})
		},
		Logf: logf,
	})
	if err != nil {
		logf("watchdog: %v", err)
		return 1
	}
	return 0
}
