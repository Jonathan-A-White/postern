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
- End-to-end tests live in `tests/e2e/`, outside the gate command (run by hand with
  `npm run test:e2e`).

## Layout

```
src/
├── gate/               # The locked gate screen (the only screen so far)
├── data/
│   ├── db.ts           # Dexie database schema (v1), one store: settings
│   └── repositories/   # Repository pattern; barrel index.ts
pwa-manifest.ts          # The PWA manifest object, shared by vite.config.ts and its unit test
features/
├── *.feature            # Gherkin scenarios, one behaviour per scenario
└── steps/                # Step definitions (@amiceli/vitest-cucumber), *.steps.ts(x)
tests/
├── setup.ts            # fake-indexeddb + jest-dom, loaded by vitest.config.ts
├── unit/                # vitest, jsdom
└── e2e/                 # playwright, against a built + previewed dist/
server/
├── go.mod              # module github.com/Jonathan-A-White/postern/server
└── cmd/postern/         # main.go: GET /healthz -> 200 "ok" on POSTERN_ADDR (default 127.0.0.1:8787)
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
