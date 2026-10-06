# Building a phone app like Postern

How to build a private channel between one person and one AI agent, as a phone app: what
Postern does, why, and where in this repository it does it, so a new app can copy the parts it
needs. Every practice below is written the same way: **the rule**, **why**, and **in Postern**
(the files that do it). The protocol itself is [protocol.md](protocol.md) and the backend's
contract is [api.md](api.md); this guide says why they are shaped the way they are.

Postern's own words: the human is the **Governor**, the agent is the **Mayor**, and the host the
agent runs on is its **home**. A **record** is one sealed message of any kind; a **road** is one
way a record can travel (the backend, or the chain).

The BSV chain is an optional layer here. Parts 1 to 3 hold with or without it; part 4 says what
it adds, and part 5, [Running without the chain](#5-running-without-the-chain), says exactly
what to drop or replace to run on the backend alone.

## 1. The shape

**The rule.** One installable web app (a PWA) on the human's phone, one small backend beside the
agent, and records sealed end to end between two keys. The backend is a postbox: it stores,
orders, wakes and relays records, and never holds a key that can read one.

**Why.** A PWA needs no app store and updates the moment a new build is served. A backend that
cannot read what it carries can be run on any host, logged freely and lost without losing a
secret. One human and one agent keep the trust model small enough to reason about: two keys, and
every record is from one to the other.

**In Postern.**

```
 phone (PWA)                        backend (Go, one binary)              agent's home
 ─────────────                      ────────────────────────              ────────────
 Dexie store  ◀── sync, stream ──── append-only index ◀── POST ────────── agent posts records
 outbox       ─── POST record ────▶ one fan-out:                          (talk, events, cards)
 service      ◀── web push ──────── push · stream event · hook ──────────▶ hook applies the
 worker                             serves sealed files ◀── writes ─────── human's actions;
                                    (view, bead detail)                    writes the view
```

- The app: [src/App.tsx](../src/App.tsx) (the door, then the shell), the screens under
  [src/cockpit/](../src/cockpit/), the protocol and I/O under [src/services/](../src/services/),
  pure logic under [src/model/](../src/model/), storage in [src/data/db.ts](../src/data/db.ts).
- The backend: [server/cmd/postern/main.go](../server/cmd/postern/main.go) wires it; the routes
  are in [server/internal/api/handlers.go](../server/internal/api/handlers.go).
- The record: one JSON envelope whose `ct` is the sealed body and whose clear fields are only
  what routing needs: `class`, `to`, `from`, `ts`, and on some classes a `lane` or `role`
  ([protocol.md](protocol.md) §1). The sealing is §2.

### Put in the clear only what the backend must act on

**The rule.** Each clear field must earn its place by a decision the backend makes without the
key: whom to push (`to`), whether to push (`class`, `lane`, `role`). Anything optional and
readable (a push's short summary, a channel name) is marked public in the spec and is left off by
a sender that wants it sealed.

**Why.** Every clear field is readable by every host and log the record passes. Naming the few
that are, and why, is what lets the rest of the system stay simple about privacy.

**In Postern.** [protocol.md](protocol.md) §1 (`summary`, `channel`, `bead` are optional and
public); the backend's parse of the clear part is
[server/internal/record/envelope.go](../server/internal/record/envelope.go).

### The agent's state is a sealed document the backend only serves

**The rule.** What the human looks at (the agent's queue, its map, a work item's detail) is built
on the agent's host, sealed to the human's key, and written as a file. The backend serves the
file's bytes with an ETag and says on the stream when it changed.

**Why.** The backend stays a postbox, and the phone can cache the whole document and open on it
instantly, offline.

**In Postern.** [server/internal/view/view.go](../server/internal/view/view.go) (serves and
watches the file), [src/services/view.ts](../src/services/view.ts) (a conditional GET, stored in
Dexie), [src/services/documents.ts](../src/services/documents.ts) (opens it and checks it came
from the pinned agent key). Spec: [protocol.md](protocol.md) §11 and §12.

## 2. The front end

### Screens read the local store, never the network

**The rule.** Every screen renders from IndexedDB through live queries. Only the sync service
talks to the backend, and it writes what it hears into the store.

**Why.** The app opens instantly and works offline, every screen showing a record changes the
moment it is stored, and no two screens race each other's fetches.

**In Postern.** [src/cockpit/hooks.ts](../src/cockpit/hooks.ts) (Dexie live queries),
[src/services/live.ts](../src/services/live.ts) (the one connection), the repositories under
[src/data/repositories/](../src/data/repositories/) (no screen touches a table directly).

### Write first, send later: the outbox

**The rule.** Every tap, answer, message and voice turn is written to an outbox table first, and
the screen goes on at once. A sender takes the rows in order, one at a time, retries a failed one
after a growing wait (2 s doubling to a minute), and resumes when the app opens, when the browser
says it is online and when the live connection returns.

**Why.** A phone loses its connection in lifts, tunnels and pockets. If the send is the only copy
of what the human did, it is lost; if the row is, a reload or a dead battery loses nothing.

**In Postern.** [src/services/outbox.ts](../src/services/outbox.ts) (the sender),
[src/model/outbox.ts](../src/model/outbox.ts) (the waits and what each screen shows),
`OutboxRow` in [src/data/db.ts](../src/data/db.ts). Scenarios:
[features/outbox.feature](../features/outbox.feature).

### Client ids: a retry is never a second message

**The rule.** Each outbox row gets a random id (128 bits) when it is written, kept in the row and
sent with every try. The backend remembers, per key, the ids it accepted recently and answers a
repeat with the first acceptance, storing, pushing and announcing nothing a second time.

**Why.** Sealing encrypts afresh on every try, so a retry whose first reply was lost carries other
bytes and cannot be deduplicated by content. Only an id fixed before the first try tells "the
same message again" from "a second message with the same words".

**In Postern.** `newClientId` in [src/data/repositories/](../src/data/repositories/),
[server/internal/api/clientids.go](../server/internal/api/clientids.go) (the memory: 24 hours, a
bounded count), [server/internal/api/direct.go](../server/internal/api/direct.go). Spec:
[protocol.md](protocol.md) §9 item 5. Scenarios:
[features/outbox-client-id.feature](../features/outbox-client-id.feature).

### Tell a final refusal from a failure to reach

**The rule.** A network failure, a timeout or a gateway error (502, 503, 504) is retried. A
refusal in the backend's own words (any other 4xx but 408 and 429) is final: the row is marked
failed with what the backend said, the rows behind it go on, and the human chooses Retry or
Discard. Voice turns travel in a lane of their own, so no upload or failing message holds one
back.

**Why.** Retrying a refusal forever is a silent loss; giving up on a dropped connection is a loud
one. A queue that stops at its first bad row stops everything.

**In Postern.** `isPermanentRefusal` and the timeouts in
[src/services/apiAuth.ts](../src/services/apiAuth.ts) (every call gives up after 30 s with no
answer), [src/cockpit/OutboxMark.tsx](../src/cockpit/OutboxMark.tsx) (Not sent, Retry, Discard),
[src/cockpit/PendingMark.tsx](../src/cockpit/PendingMark.tsx) (the mark a row wears while it
waits).

### A sent row is done when its echo comes back

**The rule.** A row the backend accepted is kept until its own record (or the event naming it)
comes back through the ordinary sync, and only then acknowledged. The sent copy is stored at
once, so it shows in its thread before the echo.

**Why.** The acceptance proves the backend took it; the echo proves the whole loop works and the
phone's store holds the authoritative copy.

**In Postern.** [src/services/outbox.ts](../src/services/outbox.ts) (ack on echo),
[src/services/deliver.ts](../src/services/deliver.ts) (stores the sent copy).

### Sync is a cursor, a stream and a poll

**The rule.** The phone keeps a cursor (the last sequence number it holds) and pages
`?since=cursor`. An event stream says when there is more: on connect it names the backend's head,
so a reconnect knows at once whether it missed anything; then one small event per new record.
Reconnect with back-off (1 s to 30 s) and sync after every reconnect. A backend without the
stream is polled.

**Why.** The cursor makes every sync idempotent and cheap; the stream makes arrival take a
second; the hello closes the gap a dropped connection leaves.

**In Postern.** [src/services/inbox.ts](../src/services/inbox.ts) (the cursor),
[src/services/live.ts](../src/services/live.ts) (the stream, read with `fetch` because
`EventSource` cannot send an `Authorization` header). Spec: [protocol.md](protocol.md) §10.

### The connection label never says live over a dead link

**The rule.** The label reads live only while the stream is proved alive: a stream with no ping
for a minute is read as dropped, and a send the backend does not answer drops the label to
reconnecting at once. A backend that did not answer at start is asked again on every turn of the
loop, so the app comes back by itself.

**Why.** A human who sees "Live" assumes the agent hears them. A stale label is worse than none.

**In Postern.** [src/services/live.ts](../src/services/live.ts),
[src/cockpit/liveLabel.ts](../src/cockpit/liveLabel.ts). Scenarios:
[features/live-silent-link.feature](../features/live-silent-link.feature),
[features/live-reconnect.feature](../features/live-reconnect.feature).

### Twins: one record that arrived by two roads is shown once

**The rule.** When the same message can arrive by two roads (for Postern, the backend and the
chain), decide which copy wins and drop the other: two rows are one message when their
ciphertext, sender, recipient and time all match, and the direct copy is kept. A copy the phone
read itself is stored under the same id the backend will later use, so the backend's copy
replaces it.

**Why.** Duplicates in a conversation make the human doubt which one the agent answered.

**In Postern.** [src/model/twins.ts](../src/model/twins.ts), applied when the store is opened
([src/data/db.ts](../src/data/db.ts)) and on sync ([src/services/inbox.ts](../src/services/inbox.ts)).
Scenarios: [features/twin-messages.feature](../features/twin-messages.feature).

### Events are kept by their sequence number and projected onto the stored state

**The rule.** The agent's events (a work item changed, a card answered) arrive in batches. The
phone keeps each event once by its own sequence number, whatever record brought it, and applies
those past its cursor, in order, to its stored copy of the agent's state. It fetches the whole
state again only on a gap or for an event it cannot apply alone.

**Why.** Screens change the moment an event arrives instead of at the next full rebuild, and
deduping by event number makes every road, retry and resend harmless.

**In Postern.** [src/model/events.ts](../src/model/events.ts) (the pure projector),
[src/services/events.ts](../src/services/events.ts) (keeps, applies, refetches on a gap). Spec:
[protocol.md](protocol.md) §22, "Deduping: by seq, never by txid". Scenarios:
[features/events-projection.feature](../features/events-projection.feature).

### A push carries nothing secret

**The rule.** A push names the record's class, its id and its time, and at most a short text the
sender chose to make public. The service worker shows a notification from that; the app decrypts
the record itself once it syncs.

**Why.** Push services are third parties. What they never receive they cannot leak.

**In Postern.** [server/internal/push/sender.go](../server/internal/push/sender.go) (what is
sent), [src/sw.ts](../src/sw.ts) and [src/push/classOptions.ts](../src/push/classOptions.ts) (one
mapping from class to title, vibration and stickiness, shared by the worker and the app so they
never drift). Spec: [api.md](api.md), "The push notifier". Scenarios:
[features/push.feature](../features/push.feature).

### A tap lands on the thing

**The rule.** Every place in the app is a URL, and a tap on a notification opens the exact place
the push is about (the thread, the work item, the call), in the open window if there is one.
Since the push carries only an id, the worker asks the same local store the app writes to find
where that id lives.

**Why.** A notification that opens the home screen makes the human hunt for what woke them.

**In Postern.** [src/nav/route.ts](../src/nav/route.ts) (every place as a `?v=` URL, so the
static host needs no rewrite rules), [src/push/tapTarget.ts](../src/push/tapTarget.ts) (where a
tap lands). Scenarios: [features/notification-tap.feature](../features/notification-tap.feature).

### Do not notify what is already on the screen

**The rule.** Before showing a notification, the worker asks a focused, visible window whether it
already shows that record (with a short deadline). When a screen shows records, the app tells the
worker so it closes their notifications.

**Why.** A buzz for the message the human is reading teaches them to ignore the buzz.

**In Postern.** [src/sw.ts](../src/sw.ts), [src/services/seen.ts](../src/services/seen.ts).
Scenarios: [features/push-seen.feature](../features/push-seen.feature).

### One queue of what waits on the human, and banners above every screen

**The rule.** The app opens on one queue, "Needs you": everything waiting on the human, most
blocking first. Anything the human answered leaves the queue at once, from the local answer,
before the agent's state catches up. What must interrupt (an emergency, the agent calling, a
send that has not gone, a new build) is a banner mounted in the shell, so it shows on every
screen; a banner the human dismissed stays dismissed across a reload.

**Why.** One queue is one place to look. A banner tied to one screen is missed on the others.

**In Postern.** [src/model/needs.ts](../src/model/needs.ts) (`unsettledNeeds`),
[src/cockpit/NeedsScreen.tsx](../src/cockpit/NeedsScreen.tsx),
[src/cockpit/Shell.tsx](../src/cockpit/Shell.tsx) (mounts
[EmergencyBanner](../src/cockpit/EmergencyBanner.tsx),
[RingBanner](../src/cockpit/RingBanner.tsx), [OutboxNote](../src/cockpit/OutboxNote.tsx) and
[UpdateBanner](../src/cockpit/UpdateBanner.tsx)).

### Easy to use correctly, hard to use incorrectly

**The rule.** A button says what a tap will do. A control the human has used goes dead and says
what happened. A one-tap action shares one state for the same item wherever it is offered, so
two taps in one moment send once.

**Why.** On a phone, a slow reply invites a second tap; a second tap on an action is a second
action.

**In Postern.** [src/cockpit/oneTap.ts](../src/cockpit/oneTap.ts),
[src/cockpit/PendingMark.tsx](../src/cockpit/PendingMark.tsx). Scenarios:
[features/answered-once.feature](../features/answered-once.feature),
[features/step-run-once.feature](../features/step-run-once.feature).

### Screens a phone can use one-handed

**The rule.** The tab bar sits along the bottom on every screen, the composer sits just above
it, and only the lowest bar keeps the safe-area inset. A wide screen gets a sidebar with the same
places. Long text wraps rather than widening the page. Layout is measured in a real browser at
phone width, never asserted in a DOM without layout.

**Why.** A thumb reaches the bottom third of a phone. A test environment without layout reports
every width as zero, so a layout claim tested there proves nothing.

**In Postern.** [src/cockpit/Shell.tsx](../src/cockpit/Shell.tsx); the `shots` project in
[playwright.config.ts](../playwright.config.ts) (a 390 px phone viewport);
[tests/e2e/long-options.spec.ts](../tests/e2e/long-options.spec.ts) (a layout claim measured).

### The key stays on the phone, unlocked once a day

**The rule.** The human's key is made on the phone, wrapped with a passkey's PRF secret (a
fingerprint), and recoverable from a phrase. Once unlocked it is kept for a day, wrapped with a
non-extractable key the browser made, so the stored row is useless anywhere else. Every backend
call signs a fresh challenge with it.

**Why.** A key that never leaves the phone cannot be taken from the backend. A daily unlock is a
fair price for a fingerprint on every open.

**In Postern.** [src/services/webauthnPrf.ts](../src/services/webauthnPrf.ts),
[src/services/vault.ts](../src/services/vault.ts),
[src/services/session.ts](../src/services/session.ts),
[src/services/keySession.ts](../src/services/keySession.ts),
[src/services/apiAuth.ts](../src/services/apiAuth.ts) (a signed challenge on every call),
[src/services/me.ts](../src/services/me.ts) (the agent's key pinned on first use; a change is
asked about, never accepted silently).

### A new build waits for a tap, and the cache never keeps a wrong file

**The rule.** A new service worker waits behind the one in control until the human taps the
update banner; the page reloads once, only when they asked. The app asks for a new build on
start, on return to the foreground and every half hour. The worker refuses to cache a script or
stylesheet whose content type does not fit its extension.

**Why.** A reload in the middle of typing loses the draft. A hashed asset URL is never fetched
again, so one bad copy cached (a server answering a missing file with the app page) breaks the
app until the cache is cleared by hand.

**In Postern.** [src/services/appUpdate.ts](../src/services/appUpdate.ts),
[src/cockpit/UpdateBanner.tsx](../src/cockpit/UpdateBanner.tsx),
[src/precacheGuard.ts](../src/precacheGuard.ts). Scenarios:
[features/app-update.feature](../features/app-update.feature),
[features/sw-asset-guard.feature](../features/sw-asset-guard.feature).

### Test first, every behaviour a scenario, every screen shot at phone width

**The rule.** Write the failing test before the code. Every behaviour is a Gherkin scenario with
steps, run in the same test command as the unit tests. End-to-end tests drive the built app in a
real browser against a stubbed backend serving a believable fixture, and each ends with a
screenshot at phone width that a human can look at.

**Why.** Scenarios say what the app does in words the human can check. The stubbed backend makes
end-to-end runs fast and repeatable. A screenshot catches what no assertion was written for.

**In Postern.** [features/](../features/) and [features/steps/](../features/steps/) (run by
vitest with `@amiceli/vitest-cucumber`), [tests/unit/](../tests/unit/),
[tests/e2e/cockpit-stub.ts](../tests/e2e/cockpit-stub.ts) (the stubbed backend),
[tests/support/cockpit-fixture.ts](../tests/support/cockpit-fixture.ts) (the fixture),
[tests/e2e/shot.ts](../tests/e2e/shot.ts) (one screenshot per spec). The gate is in
[CLAUDE.md](../CLAUDE.md).

## 3. The back end

### Small, standard library, one binary

**The rule.** One Go binary using `net/http`'s own pattern routing, configured entirely by
environment variables, with every state file under one data directory. A malformed setting stops
it at start, naming the setting.

**Why.** One person runs it. Fewer dependencies is fewer upgrades; a refusal at start is better
than a half-working backend found out later.

**In Postern.** [server/cmd/postern/main.go](../server/cmd/postern/main.go),
[server/internal/config/config.go](../server/internal/config/config.go). The settings are listed
in [api.md](api.md), "Configuration (environment)".

### Every call proves its key with a fresh signature

**The rule.** Every route but the health check and the challenge needs an `Authorization` header
carrying the caller's public key, a nonce the backend issued, and a signature over it. A nonce is
single-use and short-lived, and carries its own expiry and MAC so any backend holding the same
secret accepts it. A refusal names a machine-readable reason, and the app matches on the reason,
never the words. Each refusal writes one log line without a body, signature or nonce.

**Why.** No passwords, no sessions, nothing to steal from the backend; and the reason codes let
the app tell "no licence" from "try again with a fresh nonce".

**In Postern.** [server/internal/auth/nonce.go](../server/internal/auth/nonce.go),
[server/internal/auth/signature.go](../server/internal/auth/signature.go),
[server/internal/api/rights.go](../server/internal/api/rights.go) (which kind of key may use
which route), [src/services/apiAuth.ts](../src/services/apiAuth.ts). Spec: [api.md](api.md),
"Authentication".

### Direct delivery: check the envelope, prove the sender, name by content

**The rule.** `POST` a record and the backend parses its envelope and refuses anything malformed;
refuses it unless its `from` is the key that signed the request; names it by the hash of its
bytes; stores it; and answers its sequence number. The same bytes again, or the same client id,
are answered with the first acceptance and change nothing.

**Why.** The sender is proven, not claimed. Content names make a retry harmless; client ids
cover the retry with fresh bytes (part 2).

**In Postern.** [server/internal/api/direct.go](../server/internal/api/direct.go),
[server/internal/api/clientids.go](../server/internal/api/clientids.go),
[server/internal/record/](../server/internal/record/). Spec: [protocol.md](protocol.md) §9.

### The index: append-only, numbered, served from memory

**The rule.** Every record is appended to one JSONL file with the next sequence number, and the
file is replayed into memory on start. Readers page by sequence number. Each direct record also
carries a hash chained over every direct record before it.

**Why.** An append-only file needs no database, is never rewritten in place, and gives every
reader the same order. The hash chain makes a later rewrite of history evident.

**In Postern.** [server/internal/index/store.go](../server/internal/index/store.go). Spec:
[api.md](api.md), "GET /api/messages?since=\<seq\>"; [protocol.md](protocol.md) §9 item 4.

### One fan-out for every new record

**The rule.** Whatever road a record came by, once it is newly stored it goes through one
fan-out: the push sender, an event on the stream, and the hook. A repeat of a stored record goes
through none of them. The fan-out must not block.

**Why.** One place decides who hears about a record, so no road can forget a step and no retry
can wake anyone twice.

**In Postern.** [server/internal/notify/notify.go](../server/internal/notify/notify.go). Spec:
[api.md](api.md), "The record fan-out".

### The stream never waits on a slow reader

**The rule.** Each open stream subscribes to one hub. The subscription is taken before the hello
is built, so nothing is missed between them; a comment line goes every 25 seconds so no proxy
idles the stream out; a subscriber that falls too far behind is dropped, not waited on, and
reconnects and syncs.

**Why.** One phone on a bad connection must not hold up the agent's records for everyone else.

**In Postern.** [server/internal/events/hub.go](../server/internal/events/hub.go),
[server/internal/api/live.go](../server/internal/api/live.go). Served with
`X-Accel-Buffering: no` so the proxy in front passes each event at once.

### Push sending: by class, briefly, and only what was public

**The rule.** Push by a rule on the clear `class` (and `lane` or `role`): most classes push, the
chatty ones (voice turns, event batches, cards) never do, and their few exceptions (the agent
calling, an emergency, the agent's answer on the voice line, with no words) are named one by one. An
ordinary push lives 30 seconds at the push service; an emergency lives an hour. A subscription
whose endpoint answers `410 Gone` is dropped. The VAPID keys are made once and kept.

**Why.** A push that arrives late is noise, except an emergency. Pushing every chatty record
drains the battery and teaches the human to mute the app.

**In Postern.** [server/internal/push/sender.go](../server/internal/push/sender.go),
[server/internal/push/store.go](../server/internal/push/store.go),
[server/internal/push/vapid.go](../server/internal/push/vapid.go). Spec: [api.md](api.md), "The
push notifier".

### Event batches and lanes

**The rule.** The agent's home sends its events as one sealed record per batch of about two
seconds, never one per event, in the `normal` lane. An event that cannot wait goes alone, at once,
in the `emergency` lane, and only that lane is pushed (a bare "Emergency", the detail sealed). A
batch that could not go direct is re-sent later by another road in the `fallback` lane, with the
same events. A record has a size cap, so a batch is cut to fit and the rest follows. An event that
ends an emergency names it, so the phone clears the banner by itself.

**Why.** Batching keeps the record count and the battery cost low; a separate lane keeps the one
urgent thing from waiting behind the batch window; a fallback lane keeps the queue flowing when
the direct road is down. Because the reader dedupes by event number (part 2), resending is always
safe.

**In Postern.** The lane rule on the backend:
[server/internal/record/envelope.go](../server/internal/record/envelope.go) and
[server/internal/push/sender.go](../server/internal/push/sender.go); the app takes an emergency
ahead of every other batch: [src/services/events.ts](../src/services/events.ts) and
[src/cockpit/EmergencyBanner.tsx](../src/cockpit/EmergencyBanner.tsx). The batching itself is
done on the agent's home, outside this repository. Spec: [protocol.md](protocol.md) §22.
Scenarios: [features/emergency.feature](../features/emergency.feature).

### Hooks wake the agent, debounced

**The rule.** When the human's records arrive, the backend runs a command on the agent's host,
debounced (a burst shares one run), never two at once (a record that arrives mid-run earns one
more run), and killed after five minutes. The hook reads the records itself; nothing is passed on
its command line.

**Why.** The agent hears within a second without polling, and a burst of taps costs one run.

**In Postern.** [server/internal/hook/hook.go](../server/internal/hook/hook.go). Spec:
[api.md](api.md), "The on-message hook".

### A standby relays to the home

**The rule.** Run the backend on two hosts all the time, with a proxy in front that fails over on
`503`. A command says which host is home. The host that is not home answers `503` with
`"standby": true` to every route but the few a send needs, and relays those to the home unchanged;
it serves them itself only when it cannot connect to the home at all, and never once the home has
received any of the request, so a `POST` never runs twice. A relayed request is marked so a second
standby does not relay it again. It sends no pushes. The app, seeing standby answers, says the
home is down on every screen and offers to move it.

**Why.** Either host can die. The human can still send, including the one message that moves the
agent to the other host, and nothing is applied twice.

**In Postern.** [server/internal/standby/standby.go](../server/internal/standby/standby.go),
[server/internal/standby/relay.go](../server/internal/standby/relay.go),
[src/services/standby.ts](../src/services/standby.ts),
[src/cockpit/MoveHome.tsx](../src/cockpit/MoveHome.tsx). Spec: [api.md](api.md), "Standby";
[protocol.md](protocol.md) §18.

### Health checks, and a watchdog on a third host

**The rule.** `GET /healthz` answers without authentication: whether it is up, whether it is the
standby, and the commit it was built from. A watchdog on a host other than the backend's checks
it once a minute and pushes "unreachable" after a few minutes down, then "is back"; a short
outage is forgotten without a push.

**Why.** A backend cannot report its own death. The commit in the health line verifies a swap
without comparing binaries.

**In Postern.** [server/internal/buildinfo/buildinfo.go](../server/internal/buildinfo/buildinfo.go),
[server/internal/watchdog/watchdog.go](../server/internal/watchdog/watchdog.go),
[server/cmd/postern/watchdog.go](../server/cmd/postern/watchdog.go). Spec: [api.md](api.md),
"GET /healthz" and "The watchdog".

## 4. The chain, an optional layer

Postern uses the BSV chain (testnet, behind a chain switch) for four things. None of the practices
in parts 1 to 3 depends on it.

### What it adds

- **A second road.** When the backend cannot be reached, the phone puts a typed post on chain as
  a small funded transaction to a shared anchor address, and reads that address itself every few
  seconds, backing off when the chain provider fails or has nothing new, and not at all while the
  page is hidden. The backend's poller indexes the same records, so the agent hears them once the
  backend is back. The agent's home re-sends unsent event batches the same way (the `fallback`
  lane). [protocol.md](protocol.md) §4 and §21;
  [src/services/deliver.ts](../src/services/deliver.ts),
  [src/services/whatsonchain.ts](../src/services/whatsonchain.ts),
  [src/services/chainRead.ts](../src/services/chainRead.ts),
  [server/internal/poller/poller.go](../server/internal/poller/poller.go),
  [server/internal/woc/client.go](../server/internal/woc/client.go).
- **Licences.** A key may use the backend only while the chain holds a licence for it: a mint
  record from the issuer's key, not transferred away and not revoked. The backend walks the chain
  to check, caches the answer, and keeps the last answer across a restart.
  [protocol.md](protocol.md) §16; [server/internal/licence/](../server/internal/licence/),
  [server/internal/auth/checker.go](../server/internal/auth/checker.go),
  [src/services/mint.ts](../src/services/mint.ts),
  [src/services/issue.ts](../src/services/issue.ts),
  [src/key/IssueLicences.tsx](../src/key/IssueLicences.tsx), [src/licence/](../src/licence/).
- **Stamps.** A landing of the agent's work can leave a commitment on chain, which the work item's
  page reads back and checks. [src/services/stamp.ts](../src/services/stamp.ts),
  [src/cockpit/StampSection.tsx](../src/cockpit/StampSection.tsx).
- **A place to anchor the index's hash chain**, so a rewrite of the backend's history is evident
  to anyone ([protocol.md](protocol.md) §9 item 4).

### Rules if you keep it

- **The same record bytes on every road.** A direct record is the very script a transaction
  would carry, so one decoder serves both roads and the reader dedupes (twins, events by number).
- **Be gentle with the provider.** Pace requests under its limit, back off on `429`, fetch each
  transaction once, read only the newest page, and stop reading the moment the backend returns.
  [src/services/chainRead.ts](../src/services/chainRead.ts),
  [server/internal/woc/client.go](../server/internal/woc/client.go).
- **Say which road a post took.** A post sent on chain is final and cost coins; the bubble says
  so. The connection label says when the app is current from the chain alone.
- **Never spend a coin twice.** Remember pending spends until the provider has seen them.
  [src/services/spendable.ts](../src/services/spendable.ts),
  [src/data/repositories/pending-spends-repo.ts](../src/data/repositories/pending-spends-repo.ts).
- **A file never goes on chain.** A post with an attachment waits in the outbox for the backend.

### What it costs

Coins and a miner fee for every post on the second road; a dependency on a public provider's rate
limit; a mainnet and testnet switch to keep honest; and the code above, which is a large share of
the app's hardest tests.

## 5. Running without the chain

An app "like Postern" without the chain keeps the shape, the front end and the back end of parts
1 to 3 whole, and drops part 4. The cheapest path keeps `@bsv/sdk` purely as a crypto library
(secp256k1 keys, signatures and the BRC-78 sealing, none of which touches a chain) and removes
only what reads, writes or pays the chain.

### What stays exactly as it is

The envelope's clear fields and sealed `ct`; the key on the phone and its daily unlock; the signed
challenge on every call; the outbox, client ids and ack by echo; the cursor, stream and poll; push
with nothing secret and a tap that lands; events by number and the `normal` and `emergency` lanes;
the sealed view; the hook; the standby relay; the health check and the watchdog.

### What to drop or replace

| Piece | With the chain | Without it |
|---|---|---|
| Who may call the backend | A licence on chain, walked by [server/internal/licence/](../server/internal/licence/) and cached by [server/internal/auth/checker.go](../server/internal/auth/checker.go) | **Replace** with a list of allowed public keys in configuration, the way the mill's key (a second agent's) is already "vouched for by configuration" ([api.md](api.md), "Who may do what"; [server/internal/api/rights.go](../server/internal/api/rights.go)). A `401` then means "this key is not on the list". |
| Issuing and revoking access | Mint and revoke transactions: [src/services/mint.ts](../src/services/mint.ts), [src/services/issue.ts](../src/services/issue.ts), [src/key/IssueLicences.tsx](../src/key/IssueLicences.tsx), [src/licence/](../src/licence/), [src/services/licence.ts](../src/services/licence.ts) | **Drop.** Adding or removing a key is an edit to the allowed list and a restart. |
| The record's framing | `OP_FALSE OP_RETURN 'nftgate' 0x01 <payload>` ([protocol.md](protocol.md) §1) | **Keep or replace.** The script bytes are harmless off chain; a new app may post the JSON envelope itself and name it by the hash of its canonical bytes. Keep one framing for every sender. |
| The second road out | A funded transaction when the backend is unreachable: the chain branch of [src/services/deliver.ts](../src/services/deliver.ts), [src/services/send.ts](../src/services/send.ts), [src/services/spendable.ts](../src/services/spendable.ts), [src/services/whatsonchain.ts](../src/services/whatsonchain.ts), [src/data/repositories/pending-spends-repo.ts](../src/data/repositories/pending-spends-repo.ts) | **Drop.** A network failure leaves the row in the outbox, which tries again; the label reads reconnecting and the outbox note says the post will go when back. |
| The second road in | The phone reading the anchor address: [src/services/chainRead.ts](../src/services/chainRead.ts) and its loop in [src/services/live.ts](../src/services/live.ts) | **Drop.** The stream's back-off and the outbox's resume cover the return. |
| The poller and the provider | [server/internal/poller/](../server/internal/poller/), [server/internal/woc/](../server/internal/woc/), `POSTERN_ANCHOR`, `POSTERN_WOC_BASE` | **Drop.** Direct delivery is the only way into the index. |
| Coin routes | `GET /api/utxos/{address}`, `GET /api/balance/{address}`, `POST /api/broadcast` in [server/internal/api/handlers.go](../server/internal/api/handlers.go) | **Drop**, and drop them from the standby's list of send routes ([server/internal/standby/standby.go](../server/internal/standby/standby.go), [src/services/standby.ts](../src/services/standby.ts)). |
| The `fallback` lane | The agent's home re-sends a batch on chain | **Replace** with the home's own outbox: it keeps unsent batches and re-sends them direct, with the same client ids, when the backend answers. The phone's dedupe by event number already makes that safe. |
| Ring and events while the backend is down | Read from the chain by the phone | **Lost.** Make up for it with the standby on a second host and the watchdog's push on a third. |
| Stamps | [src/services/stamp.ts](../src/services/stamp.ts), [src/cockpit/StampSection.tsx](../src/cockpit/StampSection.tsx) | **Drop**, or **replace** with a signed note on the work item. |
| Tamper evidence | Anchor the index's hash chain on chain | **Replace** by publishing the chain's head somewhere the backend's host cannot rewrite (a commit in a repository, a line in the agent's log), or keep it informational. |
| Screen words | **Sent on chain**, **Live from the chain** | **Drop.** |

### If you also drop `@bsv/sdk`

Replace its three uses together, and keep their properties:

- **Keys and signatures.** WebCrypto ECDSA P-256 keys, made non-extractable where the platform
  allows; the challenge signature becomes ECDSA over SHA-256 of the nonce. Change the backend's
  verifier ([server/internal/auth/signature.go](../server/internal/auth/signature.go)) to match.
- **Sealing.** BRC-78 derives the AES-GCM key from the sender's private key and the recipient's
  public key, so a record that opens proves its sender, and the sender can read its own copy
  back. A replacement must keep both: a static-static ECDH between the two keys, a fresh random
  salt per record carried in the clear, HKDF to an AES-GCM key. An ephemeral-key scheme alone
  does **not** prove the sender; sign the record as well if you use one.
- **Recovery.** The recovery phrase ([src/key/](../src/key/)) can stay; it derives a seed, not a
  chain address.

### What you lose, plainly

With no chain, the backend is the only road: while no backend can be reached, nothing the human
does reaches the agent and nothing the agent does reaches the human. The outbox keeps every tap,
so nothing is lost, only late. Two hosts with the standby relay, and a watchdog that says when
both are down, are what stand in for the second road.

## 6. What to copy first

For a new app like Postern, in this order:

1. **The envelope and its sealing** ([protocol.md](protocol.md) §1 and §2): clear routing
   fields, a sealed body, two keys.
2. **The backend's core:** signed-challenge auth, direct delivery with client ids, the
   append-only index with `?since=` paging, and one fan-out
   ([server/internal/auth/](../server/internal/auth/), [server/internal/api/direct.go](../server/internal/api/direct.go),
   [server/internal/index/store.go](../server/internal/index/store.go),
   [server/internal/notify/notify.go](../server/internal/notify/notify.go)).
3. **The phone's store and the outbox:** screens read live queries; every action is a row first
   ([src/cockpit/hooks.ts](../src/cockpit/hooks.ts), [src/services/outbox.ts](../src/services/outbox.ts)).
4. **Sync:** the cursor, the event stream with its hello and ping, and an honest connection label
   ([src/services/inbox.ts](../src/services/inbox.ts), [src/services/live.ts](../src/services/live.ts)).
5. **Push with nothing secret and a tap that lands:** every place a URL first, then the service
   worker ([src/nav/route.ts](../src/nav/route.ts), [src/sw.ts](../src/sw.ts),
   [src/push/tapTarget.ts](../src/push/tapTarget.ts)).
6. **The agent's side:** the sealed view the backend serves, the hook, and event batches in their
   lanes ([server/internal/view/view.go](../server/internal/view/view.go),
   [server/internal/hook/hook.go](../server/internal/hook/hook.go), [protocol.md](protocol.md) §22).
7. **Needs you and the banners** in the shell
   ([src/cockpit/NeedsScreen.tsx](../src/cockpit/NeedsScreen.tsx), [src/cockpit/Shell.tsx](../src/cockpit/Shell.tsx)).
8. **Resilience:** the health line, the watchdog, then the standby relay
   ([server/internal/watchdog/](../server/internal/watchdog/), [server/internal/standby/](../server/internal/standby/)).
9. **The chain, only if you want a second road, licences or stamps** (part 4).

Set up the tests before step 2: the Gherkin runner, the stubbed backend for end-to-end runs, and
the phone-width screenshot project. Every step above then lands with its scenario.
