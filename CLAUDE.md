# CLAUDE.md

Development guide for AI assistants (Builders) working on Postern.

## Gate command

```bash
npm ci && TZ=UTC npm test && npm run typecheck && npm run lint
```

```bash
cd server && go build ./... && go test ./...
```

Both must pass clean before a story is done.

## Quick reference

```bash
npm run dev          # start dev server
npm run build        # tsc -b + vite build -> dist/
npm run preview      # serve dist/ locally
npm run typecheck    # tsc strict checking
npm run lint         # eslint
npm test             # vitest run (unit tests and feature specs)
npm run test:watch   # vitest watch mode
npm run test:bdd     # vitest run, features/ only
npm run test:e2e     # playwright, against `npm run preview`
```

## Tests

- Test-first: write the failing test or scenario before the code that makes it pass.
- Every behaviour gets a scenario under `features/*.feature`, with steps in
  `features/steps/*.steps.ts(x)` (@amiceli/vitest-cucumber). `npm test` runs these
  alongside the unit tests; `npm run test:bdd` runs only the features. Tags don't
  reach vitest's reported test names, so put the AC id in the Scenario title text too.
- Unit tests live in `tests/unit/`.
- Speech and the microphone in tests are bsv-kit's honest fakes (`bsv-kit/testing/speech` and
  `bsv-kit/testing/mic`), never a hand-made one: `tests/support/honest-speech.ts` puts the synthesiser
  on a clock the test moves (`advance`, `finish`); Playwright adds `speechInitScript()`/`micInitScript()`.
  They end an utterance, open a recogniser and play a clip in time, as Android Chrome does.
- End-to-end tests live in `tests/e2e/`, outside the gate command (run by hand with
  `npm run test:e2e`).

## Layout

The app is one cockpit (vault `plans/0021-cockpit-plan.md`): one shell, five places
(Needs you, Map, Talk, Search, Me), every place a `?v=` URL.

```
src/
├── App.tsx              # the door (set up / unlock once a day), then Shell + the place the route names
├── router.ts            # ?v= links as pushState; useRoute, navigate, goBack
├── nav/route.ts         # every place as a URL (old ?screen= links still land)
├── cockpit/             # the screens: Shell, NeedsScreen, MapScreen (board/graph/list), BeadScreen,
│                        #   TalkScreen, SearchScreen, MeScreen, ShareScreen, ArchiveScreen (cards untouched 48 h), Gate; Composer, Conversation;
│                        #   hooks.ts (Dexie live queries) and send.ts (what a tap delivers)
├── model/               # pure: the live view (§11/§12) and snapshot fallback, the tree and its
│                        #   columns, graph layout, filters, search, conversations, needs, threads
├── services/            # protocol and I/O: deliver (§9), live (§10 stream + polling), view (§11), events (§22, projected; useEvents), cards (§24: live cards folded from card/card-update records, ticked from held events),
│                        #   outbox (the phone's outgoing queue: written first, sent in order, acked), beads (§12), me (§15, pinned Mayor), documents (seal/open), keySession +
│                        #   session (daily unlock), blobs, recorder, messages/threads/questions (§1–§8)
├── ui/                  # design system: Icon set, primitives (Button, Chip, Card…), tokens, toasts
├── key/                 # KeyVault: create, restore, passkey, licence mint
├── data/
│   ├── db.ts           # Dexie schema (v11): settings, vault, messages, view, beadDetails, session, shares, events, outbox, cards…
│   └── repositories/   # Repository pattern; barrel index.ts
├── sw.ts                # push per class, tap lands in place, share_target parking
└── index.css            # Tailwind 4 + the design tokens (dark default, light by the phone's setting)
pwa-manifest.ts          # The PWA manifest object (incl. share_target), shared by vite.config.ts and its unit test
features/
├── *.feature            # Gherkin scenarios, one behaviour per scenario (cockpit.feature: plans/0021)
└── steps/                # Step definitions (@amiceli/vitest-cucumber), *.steps.ts(x)
tests/
├── setup.ts            # fake-indexeddb + jest-dom, loaded by vitest.config.ts
├── support/            # cockpit-fixture.ts (a believable factory), chain and WebAuthn doubles
├── unit/                # vitest, jsdom
└── e2e/                 # playwright, against a built + previewed dist/ (cockpit.spec.ts tours every place)
server/
├── go.mod              # module github.com/Jonathan-A-White/postern/server
├── cmd/postern/         # the backend (docs/api.md) and `postern watchdog`
└── internal/            # api, auth, licence (v2), index (+ direct records), events, view, beads, hook, push, watchdog…
```

## Conventions

- TypeScript strict mode — no `any` types without justification.
- Functional React components with hooks.
- Barrel exports via `index.ts` in each module directory.
- Data access goes through `src/data/repositories/`, never straight at Dexie tables from UI code.
- Test files live in `tests/unit/` with a `.test.ts`/`.test.tsx` suffix; tests run with `TZ=UTC`.
- Playwright's `webServer` binds a port other than 4173 — that's spell-forge's preview port and
  concurrent Builder sessions on this host may be using it. Check `ss -tlnp` before picking one.

## Deploy

There is **no** deploy script and **no** ssh key in this rig. `npm run build` must produce a
self-contained `dist/` (relative or root-absolute asset paths — it is served at
https://postern.allmymind.org/ by nginx). The Laptop builds `dist/` after every landing
(`npm ci && npm run build` in the rig checkout, run by mw's `after_landing`); the Mayor pulls
`dist/` to the VPS over the reverse tunnel. Do not add a `deploy` script or wire up CI deploys.

## Never

Nothing under `.github/workflows/` is touched by a Builder in this rig.
