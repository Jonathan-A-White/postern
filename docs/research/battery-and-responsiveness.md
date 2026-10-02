# Postern on the phone: what runs in the background, and what it costs

Story mw-f758y.39, for the grilling ticket mw-f758y.38. The Governor's parked want (Talk 7b850f5f, turn 13,
22:07:43Z): Postern may drain the battery or go unresponsive; find out why. Read-only on the app: nothing in
`src/` changed. Code read at commit `366c7ac` (version 0.3.0), 2026-10-02.

The short answer is in [Ranked suspects](#ranked-suspects). Two things to know first:

- **Nothing in the idle runs was slow.** No main-thread long task (> 50 ms) in any run, the JS heap is flat, the DOM
  and listener counts do not grow, and the page's own CPU is 0.2 to 0.35 s of task time per minute. If the app goes
  unresponsive on the phone, these runs did not catch it idling; see [Unresponsive](#unresponsive).
- **The measurements are a desktop Chromium, not a phone.** What they prove is what the *code* does while idle
  (requests, timers, frames, wakeups). They cannot prove screen-on time or what Android does to a page with the screen
  off, so those suspects are marked as inferred.

## 1. Inventory

Every place the app does something with no tap behind it. `file:line` is at 366c7ac. "Gate" says what stops it when the
app is in the background (screen off, another app in front); *none* means nothing in the code checks.

### 1.1 Timers

| What | Where | Period / lifetime | Gate |
|---|---|---|---|
| Mayor-presence poll: `GET /api/challenge` + `GET /api/presence`, each signed | `src/cockpit/useMayorHere.ts:23` (`PRESENCE_POLL_MS = 5_000`, line 14) | every 5 s while the Talk line screen is mounted; also at once on `visibilitychange` visible (:27) | none: it keeps asking when hidden |
| Pending-"Later" drain (an IndexedDB read-write on `settings`) | `src/App.tsx:138` | every 15 s from unlock until lock, whatever screen | none |
| Chain read while the backend is out of reach: 2 WhatsOnChain requests (`unconfirmed/history`, `confirmed/history`) + 1 per new tx | `src/services/live.ts:104-127` (`pollChain`, `CHAIN_POLL_MS = 5_000` `chainRead.ts:16`, backs off to 60 s only when a read *fails*, `chainRead.ts:19-23`) | every 5 s for as long as status is `offline` / `reconnecting` | none (the 20 s fallback poll at `live.ts:312` does check `document.hidden`; this one does not) |
| Fallback message poll when the backend has no `events` feature | `src/services/live.ts:47` (`POLL_MS = 20_000`), :311 | every 20 s | skips the sync when `document.hidden` (:312), but the timer still wakes |
| Reconnect backoff of the event stream | `live.ts:306-307` (1 s doubling to `MAX_BACKOFF_MS = 30_000`) | only after a drop | an `interrupt` abort on foreground |
| Talk wait counter | `src/cockpit/useTalkLine.ts:173` | 1 s, only while `phase === 'waiting'` (gives up at 30 s away / 90 s here, `talkLine.ts:83-85`) | stops with the wait |
| `TimeAgo` clock | `src/ui/primitives.tsx:177` | 30 s, **one interval per `<TimeAgo>` instance** (16 call sites) | none |
| Recording clock | `src/cockpit/Composer.tsx:86` | 250 ms, only while recording | stops with the recording |
| QR scan loop | `src/key/Scanner.tsx:39` (`SCAN_INTERVAL_MS = 250`) | only on the scanner; stopped on unmount (:27) | n/a |
| Update check | `src/services/appUpdate.ts:112` (`UPDATE_CHECK_EVERY_MS = 30 * 60_000`, :11), started from `src/main.tsx:20` | 30 min, plus on `visibilitychange` visible (:105) | none |
| Outbox retry wake | `src/services/outbox.ts:130-133` | one `setTimeout` per lane at the row's `nextAt` (backoff, `model/outbox.ts` `retryDelay`) | only exists while a row waits |
| View grace | `live.ts:204` (`VIEW_GRACE_MS = 10_000`) | one-shot per `view` event | n/a |
| Speech restart wait / stop guard | `src/services/listen.ts:438` (`IDLE_RESTART_WAIT_MS = 500`), :501 (`STOP_TIMEOUT_MS = 3000`) | only while a hold is on | cleared by `finish`/`abort` (:340-341, :519-520) |
| API timeout guard | `src/services/apiAuth.ts:59` (`API_TIMEOUT_MS = 30_000`) | one per request, cleared on answer | n/a |
| One-shots | `NoticeScreen.tsx:59`, `SearchScreen.tsx:81`, `Shell.tsx:49` (long-press, 500 ms), `scrollMemory.ts:68` (2.5 s), `toastStore.ts:35`, `CodeBlock.tsx:52`, `KeyVault.tsx:236,247`, `KeyQr.tsx:36`, `IssueLicences.tsx:199`, `sw.ts:92` (3 s per push), `appUpdate.ts:125` | all short, all UI feedback | n/a |
| `requestAnimationFrame` | `Composer.tsx:161,170` | one frame, on a keypress | n/a |

### 1.2 The event stream and every other long-lived connection

- **`GET /api/events`**, `src/services/live.ts:225` (`listen`), driven by `run()` (:261-318). One `fetch` whose body is
  read for as long as the page lives; the server sends `: ping` every 25 s (`docs/api.md`, `STREAM_STALE_MS = 60_000`
  at :50 calls the stream dead after 60 s of silence). Not `EventSource`: a `fetch` + `TextDecoderStream`, because the
  request is signed. Every block read does `setState({ lastHeard })` (:242), which re-renders every `useLive()`
  consumer and wakes the outbox (`outbox.ts:216-223`).
- **Reconnect policy:** on a drop, `reconnecting`, sleep 1 s doubling to 30 s (:306-307), then a full message + view
  sync (:308), so a flapping link costs a sync per attempt; `offline` only after a reconnect and its sync both fail.
  On `visibilitychange` visible / `pageshow`, `onForeground` (:358) pulls everything and, if the stream is dead,
  aborts it so a new one opens at once (3 s debounce, :52).
- **Nothing closes the stream when the page is hidden.** There is no `hidden` branch in `run()`/`listen()`; the stream
  stays open and Chrome decides what happens to it.
- **No `WebSocket`, no `EventSource`, no `BroadcastChannel`, no `navigator.locks`** anywhere in `src/`.
- Dexie `liveQuery` subscriptions: one per hook in `src/cockpit/hooks.ts:21` (14 hooks: view, messages, talk turns,
  cards, answers, outbox, bead details...). Each re-runs its query when a table it read changes, never on a clock. They
  are the reason a sync re-renders the screens; they do nothing idle.
- `matchMedia('(min-width: 1024px)')` change listener, `hooks.ts:191`: event-driven.
- `ResizeObserver`: `TalkLineScreen.tsx:84` (the scroller, for the life of the screen), `scrollMemory.ts:65` (only
  until the scroll position settles, 2.5 s).

### 1.3 Service worker (`src/sw.ts`)

No `setInterval`, no periodic or background sync, no push-subscription refresh loop. Everything is event-driven:
`fetch` (:34, :209), `activate` (:44), `push` (:140), `message` (:148), `notificationclick` (:179). One `setTimeout` of
3 s per push that asks an open window "seen?" (:92). The only periodic thing is the *page* asking the browser to look
for a new worker every 30 min (`appUpdate.ts:112`; the worker script is fetched, nothing more). Its precache is 74
entries, 7.5 MB on a first install.

### 1.4 Screen, audio, microphone

| What | Where | Lifetime |
|---|---|---|
| **Screen wake lock** | `src/services/wakeLock.ts:20-54`, taken by `useTalkLine.ts:192-195` | for as long as `line.talk !== undefined`: from the first hold until End, or until the screen unmounts. **No idle timeout.** The browser drops it when the page hides; the app re-takes it on `visibilitychange` visible (`wakeLock.ts:36-43`). |
| **Silent audio loop** (`new Audio(<0.1 s WAV>)`, `loop = true`) | `src/services/silentLoop.ts:34-40`, taken by `useTalkLine.ts:196-199` | same window as the wake lock, except while he holds the button. It exists to keep Android from suspending the page with the screen off (mw-j0f2d.29). No cap, no check that anything is still happening. |
| Speech synthesis | `src/services/speech.ts:106-122` (`speak` / `stop`), called from `useTalkLine.ts:134` and cancelled by that effect's cleanup (:136-140) | per utterance; `speechSynthesis.cancel()` on every change of state, on unmount |
| **Speech recogniser** | `src/services/listen.ts:267` (`startListening`; `continuous = true` :252) | opened on pointer-down (`useTalkLine.ts:215`); stopped on release (`session.stop()`, `listen.ts:493`, 3 s guard :501), on pointer-cancel (`TalkLineScreen.tsx:552` → `abort`), on End (`useTalkLine.ts:287`), on an error (:228-235) and on unmount (:201-207). While he holds, it restarts itself when Chrome ends it: 5 quick restarts (`MAX_IDLE_RESTARTS`, :159), then every 500 ms for as long as words were heard (:435-446). |
| Bluetooth / chosen mic input | `src/services/micInput.ts:69-79`, closed by `dropInput` (`listen.ts:315`) at `finish`/`abort` | opened with the hold, tracks stopped when it ends; the permission probe stops its track at once (:74) |
| Voice-note recorder | `src/services/recorder.ts:33-37`; tracks stopped in `release()` (:66-70) on stop and cancel | only while recording |
| Chime | `src/services/chime.ts:9-25` | one `AudioContext`, closed on `onended` (:22) |
| QR camera | `src/key/Scanner.tsx:30`; tracks stopped in `stop` (:27) on unmount | scanner screen only |
| Voice-note playback | `src/cockpit/VoicePlayer.tsx:22-29` | `timeupdate` etc. listeners on an `<audio>` element; only while playing |

Answers to the questions in the story:

- *Does the recogniser or mic stay on after a talk?* By the code, no. Every path that ends a hold ends the
  recogniser and closes the input stream (`listen.ts:338-348`, :517-528). Not exercised on a real phone.
- *After End?* `end()` aborts any session (`useTalkLine.ts:287`), the talk clears (`talkLine.ts:225`), and both the
  wake lock and the silent loop are released by their effects' cleanup. **After End nothing is left on.**
- *With the screen off?* While **holding**, if the screen goes off with the finger down the browser sends
  `pointercancel` and the hold aborts (`TalkLineScreen.tsx:552`); there is no `visibilitychange` handler that aborts a
  hold, so a lost `pointerup` with no cancel would leave the recogniser in its restart loop. Not a measured problem.
  After a hold, the mic is already closed; what stays on with the screen off is the **silent loop** and, until Chrome
  drops it at hide, the wake lock.
- *speechSynthesis:* cancelled on every state change and on unmount; the page's voice is suspended by Android when the
  page is hidden, which is why an answer arriving then is told by a notification instead (`talkAnswerNotice.ts`).

### 1.5 `visibilitychange` and `pageshow` listeners (all refresh on *return*; none stops work on *leaving*)

`live.ts:326-327` (foreground sync), `outbox.ts:231` (kick the sender), `useMayorHere.ts:27` (ask now),
`useTalkLine.ts:165` (speak the answer that waited; clear the notification), `wakeLock.ts:46` (take the lock again),
`usePrompts.ts:40` (re-ask), `Conversation.tsx:88` (retry a failed attachment), `appUpdate.ts:111` (check now).
Exactly one place looks at `hidden` to *skip* work: the 20 s fallback sync (`live.ts:312`) and `useTalkLine.ts:29`
(an answer that arrives hidden is queued unspoken).

### 1.6 Always-on animation

`animate-live` (`src/index.css:163-175`, `pc-pulse 2.4s ease-in-out infinite`, opacity 1 to 0.35) is on:

- the live dot in the header, `src/cockpit/Shell.tsx:89`, whenever `live.status === 'live'` (the normal state), on
  **every** screen, inside a header that has `backdrop-blur` (`Shell.tsx:238`);
- every "working" bead card: `src/ui/primitives.tsx:141` via `BeadCards.tsx:99,129`;
- the recording dot, `Composer.tsx:287`.

`prefers-reduced-motion` shortens animations to 0.01 ms (`index.css:114-120`), so a phone set to reduce motion is not
affected.

### 1.7 React effects that re-run every render

None found. Every `useEffect` has a dependency list; the ones with `[]` or stable deps are listed above. The idle runs
confirm it: DOM nodes and listener counts did not grow in 60 s, and `recalcStyleCount` was 0 on screens with no
animation. (`useLiveQuery` in `hooks.ts:18-29` deliberately ignores its `query` dependency, which is why it is
`deps`-keyed.)

## 2. Measurements

Harness: `docs/research/battery-measure/` (`measure.spec.ts`, `playwright.config.ts`; run instructions in the file
header and below). Playwright's full Chromium build (build 1243, the `chromium` channel) with the Pixel 7 emulation profile (412x915),
against `vite build --minify false` of this commit, the e2e stub backend (`tests/e2e/cockpit-stub.ts`), service
worker blocked, and a real held-open SSE endpoint with 25 s pings standing in for `GET /api/events`. The app is
unlocked, left to settle for 5 s, then watched for 60 s. Recorded per run: CPU of every browser process
(CDP `SystemInfo.getProcessInfo`), the page's `Performance.getMetrics`, a 1 ms-sampling `Profiler` CPU profile, every
`/api` and WhatsOnChain request, `longtask` entries, timer firings by call site, IndexedDB transactions, and (after
the 60 s, 15 s trace) frames drawn. Raw numbers: `docs/research/battery-measure/results/*.json`.

**Read these numbers as relative, not absolute.** The host (20 cores, shared with other Builders) had a one-minute load
average between 3 and 62 across the runs (`hostLoadAvg1m` in each json), and the 1 ms profiler adds overhead to the
renderer, so the renderer baseline of 3.5 to 5.5 s per minute is noise-and-profiler, not the app. A difference smaller
than that spread (the renderer figures between the quiet runs) means nothing. Frames, requests, timer firings and
long-task counts are exact counts and do not suffer from this.

### 2.1 The three requested runs (60 s idle)

| | Channels (`/?v=talk`) | Talk, no talk open (`/?v=line`) | Talk, a talk open (one turn, answered, heard) |
|---|---|---|---|
| Requests to `/api` per minute | **0** | **26** (13 `/api/challenge` + 13 `/api/presence`) | **24** (12 + 12) |
| Event-stream connections opened | 1 (held) | 1 (held) | 1 (held) |
| Main-thread long tasks > 50 ms | **0** | **0** | **0** |
| Page main-thread task time (s per min) | 0.32 | 0.17 | 0.35 |
| of which script (s per min) | 0.007 | 0.012 | 0.016 |
| Profiler busy time (ms per min, sampled) | 206 | 95 | 221 |
| Frames drawn in a 15 s trace | **900 (60 fps)** | 0 | 0 |
| GPU process CPU (s per min) | **4.55** | 0.00 | 0.00 |
| Renderer process CPU (s per min) | 6.86 | 3.72 | 5.55 |
| Audio service CPU (s per min) | 0 | 0 | **0.47** |
| IndexedDB transactions per minute | 16 | 16 | 24 |
| JS heap / DOM nodes / listeners over the minute | flat (GC dropped it) | flat | flat |
| Wake lock requested / released | 0 / 0 | 0 / 0 | **1 / 0** (held through the whole idle minute) |
| `<audio>.play()` calls (the silent loop) | 0 | 0 | 1 (and still playing) |
| Host load average at the time | 35 | 29 | 7 |

The CPU profile's top self-time entries, all runs: `(program)`, `(garbage collector)`, and in the Talk runs the
elliptic-curve maths that signs each request (`jpAdd`, `jpDouble`, `red` from `@bsv/sdk`, about 2 ms a signature, so
12 signatures a minute is 25 to 45 ms a minute). Nothing in the app's own code (`LiveBadge` 1.2 ms, `fetchMayorHere`
4 ms) is a hot spot. The page is idle (> 99.5 % of samples are `(idle)`) in every run.

**Timers that fired in the minute** (from the instrumented `setTimeout`/`setInterval`): on Channels, only
`App.tsx:138` (4 times, the 15 s drain). On Talk, that plus `useMayorHere.ts:23` (12 to 13 times). Nothing else
schedules work while idle. IndexedDB: 4 `settings` writes a minute (the 15 s drain), plus 12 `outbox` transactions
(the code ties each of the ~2.4 pings a minute to a wake of both outbox lanes, which read the queue and prune), plus 8 reads of
`messages`/`events` on Talk with a sent turn waiting for its ack.

### 2.2 The control runs that explain the numbers

| Run (60 s each, except where stated) | Result |
|---|---|
| **Channels with `animation: none`** (the pulse switched off) | frames 0 (was 900 per 15 s); GPU 0.01 s per min (was 4.55); renderer 5.34 s (was 6.86); task time 0.18 s (was 0.32). Everything else equal. |
| **Talk, a talk open, silent loop stubbed out** | no `play()` call; audio service 0 s (was 0.42 to 0.47 s per min, about 0.7 to 0.8 % of a core, to render silence); 24 requests per min **unchanged**: the loop does not change what the page does while the screen is on; what it does with the screen off is the question (see suspect 5). |
| **Talk, a talk open, page reported hidden** (`document.hidden = true` for the whole minute) | still **24 requests a minute** and 12 presence polls: the poll has no `hidden` check. This only shows what the *app's code* does for a hidden page; real Chrome throttles or freezes a hidden page's timers unless something exempts it (see suspect 5). |
| **Backend unreachable** (every `/api` call refused, WhatsOnChain answering an empty history) | **24 requests a minute to WhatsOnChain** (12 `unconfirmed/history` + 12 `confirmed/history`) + 3 to the backend, **no backoff because the reads succeed**, 49 IndexedDB transactions a minute. Forever, until the backend is back. Chain reads stay at 5 s even with the page hidden. |
| **Return to the foreground** (8 s after a `visibilitychange` visible) | 4 requests (challenge x2, messages, view), 0 long tasks, 0.11 s of task time. A cheap burst against the stub; a big backlog would be more (see Unresponsive). |
| **An unended talk three days old is on disk, and the Talk screen is opened** | the stored talk is read back as the open talk (`talkLog.ts:106-109` has no age limit), the **wake lock is requested** (1 / 0) and the **silent loop plays** (1 call), before he has touched anything. |

### 2.3 What the measurements did not show

- No idle jank: no long task, no heap or DOM growth, no listener leak (counts fell or stayed level; the one rise was +104
  listeners on a base of 1 420 in the Talk-idle run, and no other run showed it).
- No runaway timer: the only timers that fire while idle are the three in the tables (15 s drain, 5 s presence, the
  animation).
- No microphone activity at all outside a hold: the fake recogniser in the harness is only started by a hold, and the
  code review (1.4) finds no path that leaves it running.

### 2.4 Re-running

```bash
npx vite build --minify false --outDir /tmp/postern-measure-dist --emptyOutDir
npx playwright test -c docs/research/battery-measure/playwright.config.ts            # all runs, about 11 minutes
npx playwright test -c docs/research/battery-measure/playwright.config.ts -g "idle: talk-idle"
MEASURE_SECONDS=10 npx playwright test -c docs/research/battery-measure/playwright.config.ts   # a quick pass
```

Not part of the gate (outside `tests/`, its own config). To measure on a real phone, the numbers that matter are
Android's per-app battery use over an hour, with a talk left open and the screen off, against the same hour after End;
this harness cannot see either.

## 3. Ranked suspects

Ranked by how much battery or responsiveness the app plausibly costs, weighted by how well it is evidenced. "Measured"
means a number above; "inferred" means the code says so and a headless desktop run cannot check it.

### 1. A talk never ends by itself, and an open talk holds the screen on forever (inferred cost, measured behaviour)

`line.talk` stays set from the first hold until he taps End (`talkLine.ts:225`), and
`useTalkLine.ts:192-195` takes the wake lock for exactly that long. Measured: after one question and a heard answer,
with nothing happening, the lock was requested once and never released across the whole idle minute. Worse, the open
talk is **rebuilt from the stored rows with no age limit** (`talkLog.ts:106-109`): a talk he left three days ago
without tapping End is the "open talk" again the moment he opens the Talk screen, and takes the wake lock and the
silent loop straight away (measured, 2.2). A screen that stays on is by far the largest power draw a phone has, and
this is the one place the app asks for it. The 60 fps pulse in suspect 2 then runs on that lit screen.
**Fix, one line:** release the wake lock (and the silent loop) after N minutes with no hold, answer or tap
(`holdAwake` gets a timeout, e.g. 5 min, re-armed by `feed()`), and have `openTalk` treat a talk whose last row is
older than, say, 30 min as ended.

### 2. A 60 fps animation is on every screen, all the time (measured)

The live dot's `pc-pulse` runs forever while the app is connected (`Shell.tsx:89`, `index.css:173`), plus one per
"working" bead card. Measured: 900 frames in 15 s (the display's full rate) with it, **0** without; GPU-process CPU 4.55
s a minute with it, 0.01 without; and style recalculation 125 times a minute with it, 0 without (the renderer's own CPU is 6.86 s against 5.34 s, a
difference inside the run-to-run noise noted in 2). The header it sits in has `backdrop-blur`, which a changing child may force to be re-composited each frame
(plausible, not measured: the headless GPU is a software renderer). This costs while the screen is on, and with suspect
1 the screen can be on for hours. **Fix, one line:** drop `animate-live` from `LiveBadge` (`Shell.tsx:89`) and
`Dot pulse` (`primitives.tsx:141`), or limit it to `animation-iteration-count: 3`; a static dot says the same thing.

### 3. With the backend out of reach the phone reads the chain every 5 s, for as long as it stays out (measured)

`pollChain` (`live.ts:104`) makes two WhatsOnChain requests per read, every 5 s, and backs off **only when a read
fails** (`chainRead.ts:19-23`); a healthy WhatsOnChain returning an empty or unchanged history keeps it at 5 s
indefinitely. Measured: 24 requests a minute, 1 440 an hour, with the page hidden or not (no `hidden` check, unlike the
20 s poll at `live.ts:312`). That is exactly the situation the standby-home machinery (mw-43v9x) exists for, so an
afternoon with the home down is an afternoon of the radio never idling, and a free-tier WhatsOnChain being hit from the
phone. **Fix, one line:** make `nextChainDelay` grow on an *empty* read too (5, 10, 20, 40, 60 s, reset when a record
arrives) and skip the read when `document.hidden`.

### 4. A presence poll every 5 s while the Talk screen is open, signed, with no hidden check (measured)

`useMayorHere.ts:23`: 24 to 26 requests a minute (a challenge and the presence call, each its own signature), exactly the
rate the radio's tail time cannot sleep between. Cheap on the CPU (about 40 ms a minute of signing), expensive on the
modem, and it does not stop when the page is hidden (measured with `hidden` forced: still 12 polls a minute).
Only needed while a turn is *waiting*; the screen reads it once per tick of the wait anyway (`useTalkLine.ts:173`).
**Fix, one line:** poll only while `line.phase === 'waiting'` (or every 30 s otherwise), and clear the interval on
`visibilitychange` hidden; or have the backend put presence on the event stream it already holds open.

### 5. The silent audio loop is meant to defeat the browser's background handling, and nothing caps it (inferred)

`silentLoop.ts:34` plays a looped silent clip while a talk is open and he is not holding, on purpose, so Android treats
the page as playing audio and does not suspend it with the screen off (mw-j0f2d.29). A page playing audio is exempt from
Chrome's timer throttling and from freezing, which means that with the screen off, the 5 s presence poll (4), the 25 s
stream pings and the 15 s drain all **keep running** instead of being throttled to once a minute and frozen after five
minutes. It can also put an ongoing "playing audio" entry on the lock screen. Measured: the loop costs the audio
service 0.42 to 0.47 s of CPU a minute (about 0.8 % of a core) just to render silence, and it was still playing at the
end of every open-talk run. What it does to a real phone with the screen off, I could not measure. It is the multiplier
on suspects 1, 3 and 4. **Fix, one line:** stop it with the wake lock (the same idle timeout as suspect 1) and when the
page has been hidden for N minutes.

### 6. The event stream stays open in the background, and every ping re-renders and wakes the outbox (inferred)

`live.ts:225` holds one request for as long as the page lives; the server pings every 25 s, so a hidden-but-not-frozen
page wakes about 144 times an hour, and each block read does `setState({ lastHeard })` (`live.ts:242`), re-rendering
every `useLive()` consumer and kicking both outbox lanes (`outbox.ts:216-223`: 12 IndexedDB transactions a minute for
nothing). Measured: one connection held for the whole minute, no reconnect churn, 16 IndexedDB transactions a minute,
all cheap. The cost is the wakeups, which are small and which web push already covers (a phone that is not looking gets
a push). **Fix, one line:** abort the stream when the page has been hidden for 30 s (the foreground handler at
`live.ts:358` already pulls everything and reopens it on return), and only `setState` for `lastHeard` when the label
it feeds would change.

### 7. Housekeeping timers: small, but every one is a wakeup (measured and read)

- the 15 s "Later" drain (`App.tsx:138`): 4 `settings` writes a minute, forever, for something that only changes when a
  worker message or an unlock arrives (it already runs on both). **Fix:** delete the interval.
- one 30 s interval per `<TimeAgo>` (`primitives.tsx:177`, 16 call sites): not on the Channels screen of the
  fixture, so not measured; on a Needs or Map screen with a hundred cards it is a hundred timers. **Fix:** one shared
  ticker (a module-level store read with `useSyncExternalStore`).
- the 30 min update check (`appUpdate.ts:112`) is fine.

### Not suspects

The service worker (no timers, all event-driven), the speech recogniser and microphone (closed on every exit the code
has), the QR camera, the voice-note recorder, `speechSynthesis`, Dexie `liveQuery` (no clocks, no loops), React
effects (none re-run without cause), memory (flat), and long tasks (none).

## 4. Unresponsive

The idle runs give no support for the app locking up while it sits there: 0 long tasks, a page that is 99.5 % idle,
a heap that does not grow. What the code does suggest, unmeasured, are three places where *coming back* could stall:

- **Signing on the main thread.** Every `/api` call does a fresh challenge and an ECDSA signature in JS
  (`apiAuth.ts:116-132`, about 2 ms each here; a phone is perhaps 5 to 10 times slower). A foreground return
  (`live.ts:358`) fires several signed calls at once (messages, view, presence, prompts, one per new bead detail), so
  a few tens of milliseconds of signing can land in one task on a phone. Measured against the stub on the desktop: 4
  requests, no long task.
- **A page the OS froze.** After a long freeze the page returns with an event stream that is dead, a queue of
  `visibilitychange` and `pageshow` handlers all firing at once (eight listeners, 1.5), a full message + view sync, an
  outbox kick and a presence ask; the foreground debounce (`live.ts:52`, 3 s) only covers the sync.
- **A large first sync into a re-rendering app.** Every stored record makes the `liveQuery` hooks re-run (14 of them,
  most reading a whole table: `getAll`, `orderBy('ts')...toArray()`), so a long backlog re-reads and re-renders the
  tabs' badges and the open screen once per transaction. Not measured; the fixture has a few dozen records.

If the Governor's "unresponsive" means a slow return to the app after the screen was off for a long while, the thing to
measure next is a phone with a real backlog (Chrome's remote devtools trace of the first 10 s after unlocking, with
`chrome://inspect`), not more idle minutes.
