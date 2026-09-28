# Demo: the cockpit, on your phone and on the desktop

What plans/0021 promised, checked by hand after the move (vault `hosts/desktop-move.md`)
and a deploy of this branch. Each step says what you should see.

## Before you start

- The backend runs on the desktop with the v2 environment (`mw postern serve`), nginx on
  the VPS proxies `/api/` (and `/api/events` unbuffered) to it, and `mw postern view` has
  written a view at least once (`curl` from the VPS: `GET /api/view` needs a signed
  request, so check the file instead: `ls -la ~/.local/state/postern/view.b64`).
- On the phone: open https://postern.allmymind.org once so the service worker updates.

## 1. The door (decision 14)

1. Open Postern. It asks for your fingerprint **once**.
2. Close it, reopen it (or reboot the app from the switcher). It opens straight on
   **Needs you** — no second prompt — until the same time tomorrow or until **Me → Lock now**.

## 2. Needs you (decision 8)

1. The factory's pulse sits on top: working, ready, blocked, landed today, and each host
   with how long since it last synced (red past 20 minutes).
2. Below, one card per thing waiting on you, most blocking first. A question shows the
   Mayor's recommendation as the highlighted button.
3. Tap the recommendation. A toast says it was answered; the card leaves at once.
   Within a few seconds the bead carries `ANSWER …` (the backend's hook ran
   `mw postern inbox --apply`) and the Mayor has mail.
4. An **Approve** card's **Release** releases the held stories the same way.

## 3. The map at every zoom (decision 9)

1. **Map**: the maps, then the epics, each with a progress bar coloured by column.
2. Tap an epic. On the phone it opens as a **Board** (swipe the columns); on the desktop
   as a **Graph** (read left to right in the order work can happen). **List** is the third lens.
3. Type in the filter or tap a column, a rig or a host; **Save filter** keeps it (it then
   appears as a chip on the map and in **Search**).
4. Tap a story: its path, description, acceptance, what it waits on and what waits on
   it, and its whole conversation — comments and messages together.

## 4. Talking at any level (decisions 10–12)

1. On a story, type in the composer and send. The Mayor sees it on the bead as your
   words; his answer comes back in the same place.
2. Tap the quote mark beside any comment to answer that comment specifically.
3. Hold nothing: tap the microphone, speak, tap stop, send. Within a minute the voice
   note shows **Heard: …** — the desktop's transcript, not a third party's.
4. Take a screenshot anywhere on the phone → Share → **Postern** → pick a thread or a
   bead. The composer opens with the image waiting.
5. **Talk** lists every conversation: the factory-wide one first, then each bead and
   topic by its latest message, unread counts on the right.
6. The speaker icon beside any Mayor message (or in a thread's header) reads it aloud.

## 5. Steps for your hands (decision 21, protocol §17)

1. After runbook step 7b, the Mayor adds a harmless step: `mw hands add <a hitl bead>
   --id whoami --host desktop --as root -- 'id -u'`. Within half a minute it is a
   **Your hands** card: the host, **as root** in red, the exact command, the way back.
2. Tap **Approve and run**, then **Confirm and run**. Your fingerprint is asked for
   again. The card says *approved, running…*; seconds later it shows **ran just now**
   and the bead's thread has the outcome: exit 0 and `0` in the output.
3. Ask the Mayor to change the step's text with `--replace` after you have seen it,
   then approve the old card before the view refreshes: the host refuses it ("the step
   changed since you approved it") and says so in the thread. Nothing ran.

## 6. Search (decision 13)

1. **Search** "ping" (or any word): beads, descriptions and comments of beads you have
   opened, and messages, each group separately; tap a result to go there.

## 7. When the desktop is down (decision 2)

1. Stop the backend on the desktop for four minutes: the phone gets **desktop
   unreachable**. Start it: **desktop is back**. The app's status pill says Offline and
   how long, and everything already on the phone stays readable.
