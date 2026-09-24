# Research: consuming SpellForge's BSV library without forking it

Question (mw-f758y.4): how does Postern use SpellForge's BSV library — the License and
Fuel contracts, the mint/write/transfer builders, `WhatsOnChainProvider`, and key
handling — without forking it? This is not implementation; it is the groundwork
`vision.md` calls Postern's mission ("Postern needs a licence token before it can gate
anything") and the factory's own vision names as its first customer for this library.

## What's actually in `src/bsv`

Read from `~/spell-forge` at version 0.1.161 (2026-09-24). `src/bsv/` is ~20
non-contract TypeScript files plus a `contracts/` subtree:

- **Chain primitives**: `keys.ts`, `chain-provider.ts`, `whatsonchain-provider.ts`,
  `chain-error.ts`, `config.ts`.
- **Record encoding**: `record.ts`, `write-record.ts`, `read-record.ts`,
  `scan-records.ts`.
- **P2PKH-token builders** (pre-contract, mw-b00z era): `license-token.ts`,
  `token-lineage.ts`, `license-owner.ts`, `pending-spends.ts`, `send-sats.ts`,
  `fuel-status.ts`.
- **Contract-locked builders** (current path): `license-contract.ts`, which lazily loads
  `contracts/bridge/license-bridge.ts` and `contracts/bridge/fuel-bridge.ts` via
  `import.meta.glob`.
- **Node-builtin browser shims**: `process-stub.ts`, `buffer-stub.ts`,
  `browser-events.ts` (the last one is a Vite `resolve.alias` target, not an import).
- **`contracts/`**: `license.ts` and `fuel.ts` (scrypt-ts source, legacy decorators),
  `bridge/` (the plain-TS boundary the app's own `tsc` can load), `artifacts/*.json`
  (compiled sCrypt output, checked in), and `toolchain/` (an isolated `TypeScript 5.3.3`
  + `scrypt-cli` subproject used only to recompile the artifacts — never shipped, never
  run by the app).

Zero of it imports React. That matters: Postern is React 19, SpellForge is React 18, and
a naive workspace/link approach would otherwise risk a duplicate-React or peer-conflict
problem. There is no such problem here — this is a plain TypeScript module graph.

## What actually couples it to SpellForge

Three things make `src/bsv` not a clean drop-in today, independent of which
packaging option is chosen:

1. **App-specific types, imported by type only.** Ten files (`license-contract.ts`,
   `license-token.ts`, `write-record.ts`, `read-record.ts`, `pending-spends.ts`,
   `chain-provider.ts`, `whatsonchain-provider.ts`, `scan-records.ts`,
   `token-lineage.ts`, `send-sats.ts`) do `import type { EventBus, Utxo,
   AddressHistoryEntry } from '../contracts/types'`. `Utxo` and `AddressHistoryEntry`
   are pure chain primitives (trivially portable). `EventBus` is not: it's
   `emit(event: AppEvent)` / `on(type: AppEvent['type'], ...)`, and `AppEvent` is
   SpellForge's full app-event union (spelling sessions, streaks, six `bsv:*` event
   types among ~15 others). A consumer needs the six `bsv:*` events, not the other nine.
   This is a type-only coupling (erased at build time) but it has to be resolved before
   the library typechecks standalone: either genericize `EventBus<TEvent>` in the
   library and let each app supply its own event union, or narrow the library's own
   `BsvEvent` type and drop the app-wide `EventBus` shape entirely.

2. **The `import.meta.glob` decorator dodge is a Vite macro, not portable JS.**
   `license-contract.ts` loads the bridge via `import.meta.glob<...>('./contracts/bridge/license-bridge.ts')`
   (mw-5wuz6.3) *specifically* to keep the app's own `tsc -b` from following an
   `import()` into decorator-legacy `contracts/license.ts`. `import.meta.glob` only
   works because Vite's plugin pipeline processes first-party source; it is not
   standard JS, and esbuild (which Vite's dev-mode dependency pre-bundler uses) does
   not implement it. Ship this file as-is inside an npm dependency and it is at real
   risk of breaking the moment Vite's `optimizeDeps` pre-bundles it — the exact class of
   failure the rig memory already warns about for browser-only faults (mw-yo97u.11/.12):
   a vitest run would not catch it; only `vite build` + a real browser would.

3. **Node-builtin browser shims travel with the code, not with the bundler.**
   `process-stub.ts` / `buffer-stub.ts` install `globalThis` stand-ins at runtime
   (`installProcessStub`, `installBufferStub`), and `browser-events.ts` is a
   `resolve.alias` target SpellForge's own `vite.config.ts` wires up for scrypt-ts's
   `events`-extending `Provider` class. Whatever Postern ends up with, its
   `vite.config.ts` needs the same `events` alias and the same stub-install calls —
   this is a fact about `@bsv/sdk`/`scrypt-ts` in a browser bundle, not about how the
   code got into Postern's tree.

None of this is a reason the code can't be shared — it's the actual list of what any
extraction has to deal with.

## Options weighed

### A. Publish as an npm package
Extract `src/bsv` (minus `contracts/toolchain/`, `contracts/prototype/`,
`contracts/COMPILER`, `contracts/NOTES.md`, `contracts/SIZES.md` — none of that ships,
it only rebuilds the checked-in `artifacts/*.json`) into its own package with a real
build step: `tsc` emitting plain ESM `.js` + `.d.ts`. Compiling away the point:
scrypt-ts's decorators are compile-time only and leave no trace in emitted JS, so a
consumer's `tsc` never needs `tsconfig.contracts-test.json`'s legacy-decorator
settings — that whole dance stays inside the library's own build. The one-shot lazy
bridge load stops needing `import.meta.glob` at all once the source is precompiled:
it's loading one fixed relative path, not a genuine glob, so a plain
`await import('./contracts/bridge/license-bridge.js')` does the same job with no Vite
macro and no pre-bundling risk.

Distribution: **not** a public registry or GitHub Packages — this is one author, one
private consumer today (Postern), possibly more PWAs later, no reason to run an
account/token through CI. npm installs directly from a git ref with no registry at
all: `"spell-forge-bsv": "github:Jonathan-A-White/spell-forge#bsv-v0.1.0"` (or a small
dedicated repo, see Recommendation). `npm install` runs the git checkout's own
`prepare` script, so the build step travels with the tag.

Consumer side: Postern adds the dependency, adds SpellForge's `events` alias and the
two stub installs to its own `vite.config.ts`, and — because Postern already ships
`vite-plugin-pwa` with a Workbox `globPatterns` build — checks that the dependency's
compiled output lands in the same JS chunks the PWA precache already covers (it should;
nothing about a plain npm dependency changes how Vite's build emits chunks under
`vite-plugin-pwa`).

**Open, unverified**: whether Vite's dev-mode `optimizeDeps` (esbuild) pre-bundles a
plain dynamic `import()` of a relative path inside a dependency cleanly, or needs
`optimizeDeps.exclude` for this package the way linked/workspace packages typically do.
This needs a spike (`npm run dev` + open the gate + trigger a bridge load) before
trusting it, in the same spirit as mw-yo97u.11 proving browser faults with a real
build rather than vitest.

### B. Git subtree
`git subtree add --prefix=vendor/bsv <spell-forge-repo> <tag> --squash`, vendoring the
same file set as source directly into Postern's own tree. No packaging, no new build
step — `import.meta.glob` keeps working unmodified because it's genuinely first-party
source to Postern's own `tsc`/Vite. But Postern would then need to reproduce
`tsconfig.contracts-test.json`'s legacy-decorator carve-out verbatim (mw-5wuz6.2/.3) to
typecheck the vendored `contracts/*.ts`, and the app-specific `EventBus`/`AppEvent`
coupling (point 1 above) has to be patched by hand at every vendor pull, since the
vendored files still `import type { EventBus } from '../contracts/types'` and Postern
has no such file today. Updates are a manual `git subtree pull`, with no signal that
Postern has drifted behind a contract-correctness fix landed in SpellForge (e.g. any of
the mw-5wuz6.* rule fixes) until someone remembers to look. This is the "few moving
parts" charter's opposite: a second copy of security-relevant contract code that goes
stale silently.

### C. npm/pnpm workspace
Only coherent if both rigs share one repo root, which breaks millwright's one-repo-per-
rig model (each rig has its own `CLAUDE.md`, gate command, `after_landing`, and this
one's is explicitly "no deploy script or key in this rig" — folding SpellForge's app in
would violate that boundary for no reason). A `file:`/`link:` dependency pointing at a
sibling checkout only works on a host where both repos happen to be checked out
side by side; GitHub Actions (SpellForge's own CI, and any future Postern CI) checks
out one repo at a time, so this silently only works locally and breaks in CI. Ruled
out.

## Recommendation

**Option A** — publish the library, ship compiled output, install as a git-ref
dependency. Concretely:

1. In SpellForge (or a new small dedicated rig, e.g. `bsv-nftgate`, if the Mayor wants
   the library decoupled from the SpellForge app rig entirely — cleaner ownership, but
   a second rig to maintain; SpellForge's own rig memory is the natural home if that
   overhead isn't wanted yet): add a library build target (`tsc --project
   tsconfig.lib.json` with `declaration: true`, `outDir: dist/`) covering the file set
   in "Option A" above, replace the `import.meta.glob` bridge loader with a plain
   dynamic `import()` of the compiled path, and genericize `EventBus<TEvent>` (or drop
   it for a narrower `BsvEvent` callback shape) so the library typechecks without
   SpellForge's `AppEvent` union.
2. Add a `package.json` for the extracted package (`main`/`types`/`exports`, a `files`
   allowlist so `contracts/toolchain/` and friends never ship, a `prepare` script
   running the build) and tag a release (`bsv-v0.1.0`).
3. In Postern: `npm install github:Jonathan-A-White/spell-forge#bsv-v0.1.0` (or the
   dedicated-repo equivalent), add the `events` alias and stub-install calls to
   `vite.config.ts`, and spike the dev-mode `optimizeDeps` question above before
   trusting it — prove it with `npx vite build` + Playwright against the built chunk,
   the pattern the rig memory already establishes for this exact class of fault
   (mw-yo97u.11/.12).
4. Updating later is a version bump in Postern's `package.json` plus `npm install` —
   ordinary dependency-management, not a manual sync.

This is more upfront work than a subtree (a real build step has to be written and
proven), but it's the only option that keeps the scrypt-ts/Vite fragility contained to
one place, gives Postern (and any later PWA) an ordinary versioned dependency instead
of a silently-driftable copy, and needs no registry account or CI secret for a single
private consumer.

## Not done here

No code changes. This is the research asset the story asks for; the migration steps
above are not yet a story, and the `EventBus` genericization, the library build target,
and the `optimizeDeps` spike are all real work items for whoever picks this up next.
