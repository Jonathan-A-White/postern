# How Postern puts a notification on an Android phone

A brief for anyone, or anyone's coding agent, adding push notifications to a different app. It
needs no knowledge of Postern, no BSV, and no Go (Node works the same way). Postern is MIT
licensed; every link below points at a fixed commit (`8d14942`), so the line numbers hold.

## In one paragraph

Postern sends **standard Web Push**: no Firebase SDK, no Google account, no native app. The page
asks for notification permission, subscribes the browser's push manager with the server's
**VAPID** public key, and posts the resulting subscription (an endpoint URL plus two keys) to the
server. To notify, the server signs a small encrypted message with its VAPID private key and
POSTs it to that endpoint, which Chrome on Android points at Google's push service (and Firefox
at Mozilla's). The phone wakes the app's **service worker**, which runs even when the app is
closed, and calls `showNotification`. A tap fires `notificationclick`, which opens the app at the
right place. Everything the server needs is two stored keys and a list of subscriptions.

## 1. The textbook recipe

Standards: [Push API on MDN](https://developer.mozilla.org/en-US/docs/Web/API/Push_API),
[web.dev push notifications](https://web.dev/explore/notifications), RFC
[8030](https://datatracker.ietf.org/doc/html/rfc8030) (the protocol),
[8291](https://datatracker.ietf.org/doc/html/rfc8291) (payload encryption),
[8292](https://datatracker.ietf.org/doc/html/rfc8292) (VAPID). You do not implement these; a library does.

**Libraries.** Node: [`web-push`](https://github.com/web-push-libs/web-push) (also Python
`pywebpush`, PHP, Java, C# under the same organisation). Go:
[`github.com/SherClockHolmes/webpush-go`](https://github.com/SherClockHolmes/webpush-go) (Postern
uses v1.4.0). Front end: nothing, the browser APIs are enough. If you use Vite,
[`vite-plugin-pwa`](https://vite-pwa-org.netlify.app/) with the `injectManifest` strategy lets
the service worker be a TypeScript file that imports your own modules (Postern does this,
`vite.config.ts`).

1. **VAPID keys.** Generate one key pair once (`webpush.GenerateVAPIDKeys()` in Go,
   `webpush.generateVAPIDKeys()` in Node), store it, never regenerate it: a new key makes every
   existing subscription useless, because each browser subscription is bound to the public key it
   was made with. Postern generates on first run into a file with mode 0600 and lets environment
   variables override it ([`vapid.go` L51-L76](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/server/internal/push/vapid.go#L51-L76)).
   VAPID also wants a contact (`mailto:` or `https:`) in every send.
2. **Serve the public key.** One GET returns it
   ([`handlers.go` L221](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/server/internal/api/handlers.go#L221)).
3. **Register a service worker** (a file served from your origin root, so its scope covers the app).
4. **Subscribe**, from a user tap (never on page load): `Notification.requestPermission()`,
   fetch the public key, `registration.pushManager.subscribe({ userVisibleOnly: true,
   applicationServerKey })` (the key must be a `Uint8Array`, so convert it from base64url), then
   POST `subscription.toJSON()` to your server. Postern:
   [`src/services/push.ts` L32-L60](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/src/services/push.ts#L32-L60).
   `userVisibleOnly: true` is mandatory in Chrome: it is your promise that every push shows a
   notification (see §4).
5. **Store the subscription** against your own notion of "who": a user id, a device. Key it by
   `endpoint` (re-subscribing from the same browser replaces the row). Postern keeps one JSON
   file; a database table is the same thing
   ([`store.go` L18-L65](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/server/internal/push/store.go#L18-L65);
   the HTTP handler is
   [`handlers.go` L630-L664](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/server/internal/api/handlers.go#L630-L664)).
   Authenticate this endpoint: otherwise anyone can register for someone else's notifications.
6. **Send.** For each of the recipient's subscriptions call the library with a JSON payload, a TTL
   and an urgency. **If the push service answers 404 or 410 the subscription is dead (the user
   unsubscribed or uninstalled): delete it.** Any other non-2xx is an error to log and retry
   later. Postern's whole send step is
   [`sender.go` L351-L381](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/server/internal/push/sender.go#L351-L381).
   Do the send in a goroutine / without awaiting it in the request that caused it, and put a
   timeout on it (Postern: 15 s,
   [`sender.go` L138-L144](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/server/internal/push/sender.go#L138-L144)).
7. **Receive**, in the service worker: on `push`, parse `event.data.json()` and call
   `self.registration.showNotification(title, options)` inside `event.waitUntil(...)`. Postern:
   [`src/sw.ts` L118-L165](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/src/sw.ts#L118-L165).
8. **Tap**: on `notificationclick`, close the notification, then focus an existing window and
   navigate it, or `clients.openWindow(url)` if none is open. Put the target URL in the
   notification's `data` when you show it. Postern:
   [`openAt`, `sw.ts` L181-L192](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/src/sw.ts#L181-L192)
   and [`notificationclick`, L201-L212](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/src/sw.ts#L201-L212).

A payload is limited to about 4 KB after encryption. Send a short JSON (what kind, an id, a
timestamp, optionally a title and a line of text) and let the app fetch the rest when opened.

## 2. What Postern adds, and why

Each of these is optional. None is needed for a working notification.

- **Per-class notification options.** A push says what class it is (`message`, `alarm`,
  `decision-needed`...); a pure function maps the class to a title and `showNotification` options:
  `vibrate` pattern, `tag` (a second notification with the same tag replaces the first),
  `renotify`, `requireInteraction` (stays until dismissed), `silent`, action buttons, and the
  tap URL in `data`. The user has four switches per class (sound, vibrate, stay, quiet), read in
  the service worker at push time. Why: Android gives a web app only one notification channel,
  so per-notification options are the only lever for "this one is urgent, that one is quiet".
  The same module is imported by the settings screen and the worker, so they cannot drift:
  [`src/push/classOptions.ts` L33-L76, L213-L239](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/src/push/classOptions.ts#L213-L239).
  Note: `silent: true` also mutes vibration, so a class with vibrate on must not be silent.
- **Minimal payload; content stays in the app.** The push is `{class, txid, ts}` plus at most an
  80-character clear summary; messages are end-to-end encrypted and the app decrypts them when it
  opens. Why: the push service (Google) sees every payload's size and timing; keep what it can
  read to a minimum. Even with ordinary content this is a good habit, since the payload cap is
  small ([`sender.go` L119-L132](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/server/internal/push/sender.go#L119-L132),
  [`clipSummary`, L316-L323](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/server/internal/push/sender.go#L316-L323)).
- **TTL by importance, urgency high.** An ordinary push lives 30 s (worthless late, so the push
  service drops it rather than delivering a stale buzz when the phone returns); an emergency
  lives an hour. All pushes use `Urgency: high` so a dozing phone is woken
  ([`sender.go` L108-L114, L191-L194](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/server/internal/push/sender.go#L108-L114)).
- **Skip a notification the user is already looking at.** On `push`, the worker lists window
  clients; if one is focused and visible, it asks that window "is message X on screen?" over
  `postMessage` and waits up to 3 s (`SEEN_WAIT_MS`); on yes it shows nothing and tells the
  window to refresh. The reverse also exists: when the app shows a message, it tells the worker,
  which closes that message's notification. Why: a buzz for what you are reading is noise
  ([`sw.ts` L64-L116, L147-L154, L167-L179](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/src/sw.ts#L64-L116)).
- **Quiet while in a conversation.** If the focused window is on the chat screen, the
  notification is shown but silenced (`quietedForTalk`,
  [`classOptions.ts` L154-L161](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/src/push/classOptions.ts#L154-L161)).
- **A ring.** One class shows like an incoming call: a long vibration pattern, `requireInteraction`,
  a fixed tag with `renotify`, and two action buttons (Answer, Later). A Web notification cannot
  loop, so the pattern is ten 600 ms pulses
  ([`classOptions.ts` L117-L152](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/src/push/classOptions.ts#L117-L152)).
  A tap on Later with no window open is parked in IndexedDB and delivered on next open
  ([`sw.ts` L194-L199](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/src/sw.ts#L194-L199)).
- **Twin skip.** Postern delivers some messages twice (a fast direct path and a durable chain
  path). The sender keeps a 24 h, 4096-entry memory of a hash of (to, from, time, ciphertext) and
  sends one push per message whichever copy arrives first; if the first attempt reached no
  device it forgets the key so the second can try
  ([`twin.go`](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/server/internal/push/twin.go#L21-L62)).
  You need this only if your app can produce the same event twice (retries, a poller plus a webhook).
- **Mute mode.** While a user's "Ideas only" mode is on, only a ring and an emergency are
  pushed; the check is one interface call before sending
  ([`sender.go` L212-L231](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/server/internal/push/sender.go#L212-L231)).
  The generic form is "ask a do-not-disturb policy before every send".
- **Alarms with no record.** A separate watchdog process pushes "server unreachable / back" alarms
  by broadcasting a payload that carries its own title and body, because there is no stored
  record for the app to decrypt
  ([`Broadcast`, `sender.go` L325-L345](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/server/internal/push/sender.go#L325-L345)).
  Useful if you want an independent "your server is down" push: it must not depend on the thing it is watching.

## 3. Quick start for your agent

1. Add the library (`npm i web-push`, or `go get github.com/SherClockHolmes/webpush-go`).
2. Generate and store VAPID keys once; expose `GET /push/vapid-public-key`.
3. Add `POST /push/subscribe` (authenticated; upsert by `endpoint`), and a table of subscriptions.
4. Add a service worker with `push` and `notificationclick` handlers (§1, steps 7-8).
5. Add a "Turn on notifications" button that runs step 4 of §1.
6. On the server event you care about, send to each subscription of the recipient with a small JSON
   payload, `TTL` of 30 to 3600 s to taste, `urgency: 'high'`; delete the subscription on 404/410.
7. Test on a real phone, with the app installed and then closed.

## 4. Android notes

- **Install it.** Chrome on Android delivers web push to an ordinary tab, but the app is far more
  reliable as an **installed PWA** (manifest with `name`, icons, `display: standalone`, served over
  HTTPS; Chrome offers "Install app"). iOS is different: web push works only for an installed PWA
  on iOS 16.4 or later.
- **Permission.** Ask from a tap, never at load; Chrome may quietly suppress prompts that
  come without a gesture and, after a user blocks you, you cannot ask again: show how to re-enable under Android
  Settings, Apps, Chrome, Notifications, or the site's settings. Show the real state (Postern's
  "Notify me" button reads `Notification.permission` and the existing subscription,
  [`push.ts` L62-L84](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/src/services/push.ts#L62-L84)).
- **One channel per origin.** Chrome creates a single Android notification channel for your site.
  Per-class sound and vibration must be done with `showNotification` options (§2), not Android
  channels. Real channels need a Trusted Web Activity wrapper
  ([notes](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/docs/research/notifications.md)).
- **Doze and battery saver.** When the screen is off and the phone still, Android's Doze defers
  normal network and background work. Google's push channel is exempt for **high-priority**
  messages, which wake the device briefly; Chrome passes the Web Push `Urgency` header on as that priority
  (high urgency is the one to use for anything time-sensitive).
  Normal and lower urgencies may be delayed until a maintenance window. Battery saver and
  per-app "battery optimisation" or "restricted" settings can still delay or stop delivery (some
  manufacturers are harsher); the practical advice to users is to set Chrome or the installed app
  to "Unrestricted" if pushes arrive late.
- **TTL.** The push service holds an undeliverable message (phone off, offline) for `TTL` seconds,
  then drops it. `TTL: 0` means "now or never". Choose it by how long the news stays true: a chat
  message minutes, an emergency an hour or more, a "login code" a minute. If TTL is too long the
  phone wakes later to a stale buzz; too short and an unlucky doze loses it.
- **Always show something.** Because of `userVisibleOnly`, a `push` handler that does not call
  `showNotification` makes Chrome show a generic "This site has been updated in the background"
  notification, and a site that keeps doing this risks losing the permission. If you decide not to show one
  (Postern's seen-suppression), you are relying on a visible window, so only do it in that case.
- **Tags and `renotify`.** Reusing a `tag` replaces the earlier notification; `renotify: true`
  makes the replacement alert again. Without `renotify` a replacement is silent, which can look
  like a missed push.
- **Subscriptions can change.** The browser can rotate the subscription (clearing site data, a
  long idle period, reinstalling). Re-run your subscribe step when the app opens and the stored
  one is missing or differs, and expect 404/410 to prune dead ones.

## 5. Worth a shared library?

**Server side: no. Use the standard libraries.** `web-push` (Node) and `webpush-go` already do
VAPID, encryption, TTL and urgency. What Postern wraps around them is a 20-line key loader, a
subscription table, 404/410 pruning, and a goroutine with a timeout. That is a page of code in any
language and depends on your storage; a library would be thinner than its documentation.

**Client side: a small library is worth it, if a second app wants it.** Three pieces of
the service worker are generic, fiddly to get right and not in any standard library:

1. the **seen handshake** (ask visible windows, wait with a timeout, suppress, close on read);
2. the **class table** (class to `showNotification` options, user switches, silent-vs-vibrate rule);
3. **tap routing** (focus an open window and navigate it, or open one; park an action taken with
   no window until the next open).

Not worth carving out: the twin skip (it exists because of Postern's two delivery paths), the
sealed-payload design, the Ideas-only policy, the watchdog, and the ring's content. Those stay in
the app that needs them.

**Proposed shape.** Name: `push-kit` (an npm package, MIT, no runtime dependencies, TypeScript only; no Go package). Layout:

```
push-kit/
  src/subscribe.ts   subscribe({ vapidKeyUrl, subscribeUrl, fetch }) -> PushSubscription
                     permissionState() -> 'unsupported' | 'default' | 'denied' | 'granted' | 'subscribed'
  src/worker.ts      createPushWorker({ classes, isSeen?, onTap?, settings? })
                     installs the push, notificationclick and message listeners
  src/classes.ts     defineClasses({ alarm: { title, vibrate, tag, renotify, stay, url(payload) }, ... })
                     -> spec(class, payload, userSwitches) -> { title, options }   (pure, testable)
  src/seen.ts        askWhetherSeen(clients, id, waitMs) / the window-side answer helper
  src/tap.ts         openAt(url) and a pending-action queue (IndexedDB)
```

API sketch:

```ts
// sw.ts
createPushWorker({
  classes: defineClasses({ message: {...}, alarm: {...} }),
  idOf: (payload) => payload.id,               // enables seen-suppression
  switches: () => loadUserSwitches(),           // optional; defaults per class
});
// page
const seen = answerSeen((id) => isOnScreen(id)); // replies to the worker's "seen?"
```

The server stays on the standard libraries; the kit would document the payload shape
`{ class, id, ts, title?, body? }` so any backend can speak it. Build it only when a second app
asks for it: today the code is tied to Postern's classes and settings store, and extracting it is
a day of work that a copy of §2's files by Luke's agent does faster.

## Files to read first

[`src/services/push.ts`](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/src/services/push.ts),
[`src/sw.ts`](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/src/sw.ts),
[`src/push/classOptions.ts`](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/src/push/classOptions.ts),
[`server/internal/push/sender.go`](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/server/internal/push/sender.go),
[`store.go`](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/server/internal/push/store.go),
[`vapid.go`](https://github.com/Jonathan-A-White/postern/blob/8d149422b221137051b2f910408857dc93252198/server/internal/push/vapid.go).
