# Research: classifying notifications on Android, and Web Push from Go

Question: how far can a PWA's notifications be classified on Android so the Governor can treat
classes differently (sound, buzz, watch-only), and what does the Go backend need to send them?

## Short answer

As a plain installed PWA (what Postern is today), Chrome on Android gives you **one Android
notification channel per origin**, not one per notification type. Everything Postern pushes —
a landing to verify, an alarm, a chat message — lands in that same channel and is subject to
whatever the Governor sets for it in Android's system notification settings (sound on/off,
vibrate on/off, show on lock screen, etc.). Within that one channel, the `Notification` /
`showNotification()` options let each *individual* notification opt in or out of sound and
vibration, so per-class behaviour is still possible, just controlled by Postern's own payload
rather than by Android's per-channel UI. Getting real, Android-Settings-visible channels (so the
Governor could mute "landing to verify" but keep "alarm" audible, independently, from Android's
own UI) requires wrapping the PWA in a Trusted Web Activity (TWA) with notification delegation —
a small native shell around the same web app. Wear OS mirrors whatever channel behaviour the
phone lands on; there's no separate web-only path to the watch.

## 1. What a plain PWA can control (no native wrapper)

The web platform's control surface is the [`Notification`
options](https://developer.mozilla.org/en-US/docs/Web/API/Notification/Notification) passed by
the service worker to `registration.showNotification(title, options)`:

| Option | Effect |
|---|---|
| `vibrate` | A vibration pattern (array of ms on/off), used if the device supports it and the notification isn't silent. |
| `silent` | If `true`, suppresses sound and vibration entirely regardless of device settings. Cannot be combined with `vibrate`. |
| `tag` | Groups notifications; a second notification with the same `tag` replaces the first instead of stacking. |
| `renotify` | If `true` (requires `tag`), a replacing notification re-alerts the user (re-vibrates/re-sounds) instead of updating silently. Chrome's implementation of this is mobile-oriented. |
| `requireInteraction` | Keeps the notification visible until dismissed/clicked, instead of Chrome's normal auto-timeout on mobile. |

These are per-notification, decided by whatever code calls `showNotification` (Postern's service
worker, driven by the payload the Go backend pushed). So Postern already has a lever for "this
class buzzes and stays until dismissed" vs. "this class is silent and self-dismisses" — it's just
implemented in the payload/service-worker, not in Android's Settings app.

What's **not** available from the web platform: a named, user-configurable Android notification
channel per class. Chrome (and Chromium-based browsers generally) create a single system
notification channel per **origin** the first time that origin sends a notification, generally
surfaced to the user as the site's name. Every notification from that origin — regardless of
`tag`, `vibrate`, or anything else — is filed under that one channel. If the Governor opens
Android Settings → Apps → Chrome → Notifications → postern.allmymind.org, he'll see one togglable
channel, not one per class. This is a long-standing, deliberate limitation of the web Notification
API on Android: there is no `channelId` parameter exposed to web push.

## 2. Getting real Android channels: Trusted Web Activity (TWA)

A [Trusted Web Activity](https://developer.chrome.com/docs/android/trusted-web-activity) is a
thin native Android shell (built with Google's `android-browser-helper` / Bubblewrap tooling) that
launches the same PWA full-screen, backed by Chrome, but is a distinct installed Android app with
its own `AndroidManifest.xml` and package name. Two things become possible that aren't possible
in the plain-PWA case:

- **Notification delegation.** The TWA shell can register a `TrustedWebActivityService`
  (`androidx.browser.trusted`). When Chrome would show a notification for a delegated origin, it
  instead hands the notification to the shell app, which posts it itself via
  `NotificationManagerCompat`. Because the shell is a normal native app, it can define as many
  `NotificationChannel`s as it wants (e.g. "Verify", "Alarm", "Message") in its own manifest/code,
  each independently configurable by the Governor in Android Settings — separate sound, separate
  vibration, separate importance, separate do-not-disturb behaviour.
  ([demo](https://github.com/GoogleChrome/android-browser-helper/tree/main/demos/twa-notification-delegation).)
- **Attribution changes.** Delegated notifications are governed by the shell app's own
  notification permission and settings, not Chrome's, and show the shell app's icon/identity.

The cost: Postern would need a small Android project (Bubblewrap can scaffold it from the PWA
manifest in an afternoon), a signing key, and a Play Store listing or sideloaded APK — this is a
real increase in surface area, not a config flag. It doesn't change anything about the web app or
the Go backend; it changes how notifications are *displayed* once they arrive.

A full native rewrite is not required — TWA reuses the existing PWA. The alternative "thin native
wrapper" the story description mentions is essentially this: TWA is the standard, supported way to
do it; a bespoke WebView wrapper could do the same via its own `NotificationManager` calls but
would give up Chrome's install/update/service-worker machinery for no benefit here.

## 3. Watch mirroring (Wear OS)

Wear OS mirrors notifications from the paired phone to the watch by default — this is a system
behaviour, not something an app or a web page opts into. What determines whether a given
notification is bridged (and how it appears) is which Android notification channel it belongs to,
and that channel's importance/visibility settings:

- Whatever channel a notification lands in (the single Chrome-origin channel today, or Postern's
  own channels under a future TWA), Wear OS bridges it using that channel's settings unless the
  channel is explicitly excluded from bridging.
- There's no separate "web push to watch" path — the notification has to exist as an Android
  notification first (which it does, either via Chrome's origin channel or via TWA delegation);
  the watch sees a mirror of it.
- Consequence for classification: today, "watch-only" (buzz the watch, not the phone) isn't
  achievable from a plain PWA — Android's mirroring works at the channel level, and there's only
  one channel. Under a TWA with per-class channels, a "watch" class could plausibly be built by
  giving that channel low importance on the phone (silent there) while relying on default
  bridging to still surface it on the watch — but that depends on Wear OS honouring per-channel
  bridge settings the Governor hasn't explicitly changed, and would need to be verified on his
  actual watch/phone pairing before being relied on.

## 4. Web Push (VAPID) from the Go backend

Sending push messages doesn't depend on the classification question above — it's how Postern gets
a message to the browser at all, on desktop or Android, PWA or TWA. The browser subscribes via
`PushManager.subscribe()` in the frontend, which yields a `PushSubscription` (an endpoint URL plus
`p256dh`/`auth` keys) that Postern stores server-side against the Governor's device. The Go
backend then pushes to that endpoint using [VAPID](https://datatracker.ietf.org/doc/html/rfc8292)
(RFC 8292) authentication plus [RFC 8291](https://datatracker.ietf.org/doc/html/rfc8291) payload
encryption — no third-party push service (no FCM account, no APNs) is needed for a self-hosted
Go backend; the browser's push endpoint (Chrome's is a Google-operated endpoint, but Postern never
talks to Google's API directly, just to the opaque subscription URL) handles delivery.

For Go, [`github.com/SherClockHolmes/webpush-go`](https://github.com/SherClockHolmes/webpush-go)
is the established library and covers what's needed:

```go
privateKey, publicKey, err := webpush.GenerateVAPIDKeys() // once, store both; publicKey ships to the frontend

resp, err := webpush.SendNotification([]byte(payloadJSON), subscription, &webpush.Options{
    VAPIDPublicKey:  publicKey,
    VAPIDPrivateKey: privateKey,
    Subscriber:      "governor@example.com", // contact email required by VAPID
    TTL:             30,
    Urgency:         webpush.UrgencyHigh, // affects mobile battery/delivery scheduling, not sound/vibration
})
```

- `payloadJSON` is whatever Postern's service worker expects in its `push` event handler — this
  is where a "class" field belongs (e.g. `{"class":"alarm","title":"...","body":"..."}"`), which
  the service worker then maps to `vibrate`/`silent`/`tag`/`requireInteraction` when it calls
  `showNotification`. Classification is therefore mostly a *frontend/service-worker* concern; the
  Go backend's only job is to tag the payload with a class and let the service worker decide the
  Notification options (and, under a future TWA, the channel).
- `Urgency` (`very-low`/`low`/`normal`/`high`) is a hint to the push service about battery-aware
  delivery timing (e.g. Chrome may defer `low` urgency on a resource-constrained device) — it is
  not a sound/vibration control.
- One subscription per browser install; Postern would need a small table to store
  endpoint+keys per device, expected to already fit the existing Dexie/repository pattern on the
  frontend if subscriptions are ever mirrored client-side, and a corresponding Go-side store
  (not yet built — no such table exists in `server/` today).

## 5. Proposed classes (for the Governor to decide)

Four classes suggested by the story description, with what's achievable today (plain PWA) vs.
after a TWA:

| Class | Suggested behaviour | Plain PWA (now) | With TWA channels (later) |
|---|---|---|---|
| **Decision needed** | Vibrate, stays until dismissed | `vibrate` + `requireInteraction: true`, default (non-silent) | Own channel, high importance, default sound |
| **Landing to verify** | Normal alert | Default sound/vibrate, `tag: "landing"` so repeats replace | Own channel, default importance |
| **Alarm** | Loud, insistent, re-alerts on repeat | `vibrate` (long/repeating pattern) + `renotify: true` + `requireInteraction: true` | Own channel, max importance, bypass-DND if the Governor wants |
| **Message** | Quiet, watch-friendly | `silent: false` but soft `vibrate`, no `requireInteraction` | Own channel, low/default importance, tuned for watch mirroring |

All four are distinguishable *today* purely through payload-driven `showNotification` options
within Postern's single Chrome-origin channel; the difference a TWA adds is that the Governor
gets independent, Android-Settings-level control per class (mute "Message" entirely without
touching "Alarm") instead of trusting Postern's own payload logic every time. Recommendation: ship
class-tagged payloads and per-class `showNotification` options now (no new native surface,
works within the current PWA), and treat the TWA wrapper as a separate, later decision once it's
clear the Governor actually wants independent Android-Settings control rather than what
payload-level tuning already provides.

## Sources

- [MDN: Notification()](https://developer.mozilla.org/en-US/docs/Web/API/Notification/Notification)
- [web.dev: Notification behavior](https://web.dev/articles/push-notifications-notification-behaviour)
- [Chrome for Developers: Trusted Web Activity](https://developer.chrome.com/docs/android/trusted-web-activity)
- [android-browser-helper: TWA notification delegation demo](https://github.com/GoogleChrome/android-browser-helper/tree/main/demos/twa-notification-delegation)
- [Android Developers: TrustedWebActivityService](https://developer.android.com/reference/kotlin/androidx/browser/trusted/TrustedWebActivityService)
- [Android Developers: Bridging options for Wear OS notifications](https://developer.android.com/training/wearables/notifications/bridger)
- [Android Developers: Notifications on Wear OS](https://developer.android.com/training/wearables/notifications)
- [RFC 8292: Voluntary Application Server Identification (VAPID) for Web Push](https://datatracker.ietf.org/doc/html/rfc8292)
- [RFC 8291: Message Encryption for Web Push](https://datatracker.ietf.org/doc/html/rfc8291)
- [github.com/SherClockHolmes/webpush-go](https://github.com/SherClockHolmes/webpush-go)
