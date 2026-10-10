# Module map

What Postern is made of, which files every story fights over, and the splits that would let two
stories change two modules at once. Written 2026-10-09 at base commit `d1cfa21` (version 0.5.11)
for mw-vtjxh4.24; it describes the code as it is and moves nothing.

**Why it exists.** The Governor, 2026-10-09: modules "so that you can make updates in parallel
without affecting others ... carving out the right responsibilities, right module boundaries, right
API", and "put them in the right shared libraries ... create the repos". The factory runs two
stories of one rig in series when they edit the same file, so the files at the top of section 2 are
the factory's real bottleneck, and section 3 is the plan to remove it. The rule behind it is
Modular Boundaries (the Builder's PWA best practices, rule 27); section 4 names where Postern
breaks it; section 5 names what another app could use.

**How to read it.** A path in inline backticks names a file or folder that exists at the base
commit (a test, `tests/unit/module-map.test.ts`, fails when one stops existing). A file this map
*proposes* appears only inside a fenced block, never in inline backticks. Counts come from
`git log --since=30.days` and `wc -l`; they drift, so a Builder who edits this map re-runs them.

## 1. Modules

Ten folders under `src/` (`cockpit`, `model`, `services`, `data`, `nav`, `ui`, `key`, `markdown`,
`push`, `licence`) and eight loose files. The cockpit and the services are over half the code.

| Module | One responsibility | Entry file and exported API | Imports (count of import lines) |
|---|---|---|---|
| `src/cockpit/` (62 files, 7481 lines) | Every screen and the hooks and helpers only screens use. | No entry file: `src/App.tsx` imports each screen by name. Shared by screens: `src/cockpit/hooks.ts` (about 20 `use…` live-query hooks), `src/cockpit/send.ts` (what a tap delivers), `src/cockpit/Shell.tsx` (`Shell`, `Screen`). | services (85), model (84), ui (59), data (28), nav (25), router (19), push (4), markdown (4), chain (2); packages bsv-kit composer and whats-new, dexie, react |
| `src/model/` (23 files, 3375 lines) | Pure rules over the stored view and messages: the tree, columns, filter, search, needs, conversation, Talk line state machine. No I/O. | No entry file. Each file is one rule set: `src/model/view.ts` (`decodeView`, `decodeBeadDetail`), `src/model/tree.ts`, `src/model/conversation.ts` (`mergeConversation`, `itemFromMessage`), `src/model/needs.ts`, `src/model/talkLine.ts` (`talkLine`, `initialTalkLine`), `src/model/prompts.ts`. | data (12), services (11), markdown (3), ui (1) |
| `src/services/` (57 files, 5690 lines) | Protocol and I/O: send and receive (§9, §10), the live connection, the outbox, the key session, the chain reads, speech, push registration. | No entry file; the cockpit imports 36 of the 57 files directly. Core: `src/services/apiAuth.ts` (`apiFetch`, the signed /api door), `src/services/deliver.ts` (`deliver`, `writeBehind`), `src/services/live.ts` (`startLive`, `stopLive`, `useLive`), `src/services/inbox.ts` (`syncMessages`, `storeRecord`), `src/services/outbox.ts` (`enqueue`, `startOutbox`), `src/services/speech.ts` (`speak`, `pause`, `resume`, `stop`). | data (28), model (19), push (3), nav (2), chain (2), markdown (1); @bsv/sdk, @scure/bip39, spell-forge-bsv, bsv-kit, react |
| `src/data/` (13 files, 1008 lines) | The Dexie database: its schema and one repository per table. | `src/data/db.ts` (the `db` and every row type), `src/data/repositories/index.ts` (the barrel: `messagesRepo`, `outboxRepo`, `viewRepo`, `settingsRepo`, `vaultRepo`, `cardsRepo`, `eventsRepo`, `answersRepo`, `draftsRepo`, `snapshotRepo`, `pendingSpendsRepo`). | model (3), push (2), services (1); dexie |
| `src/nav/` plus `src/router.ts` (3 + 1 files, 596 + 95 lines) | Every place as a `?v=` URL: parse, format, Back, and where he was (last route, scroll). | `src/nav/route.ts` (`Route`, `parseRoute`, `formatRoute`, `beadHref`), `src/router.ts` (`useRoute`, `navigate`, `goBack`), `src/nav/lastRoute.ts`, `src/nav/scrollMemory.ts` (`useScrollMemory`). | model (2), router (1), data (1); react |
| `src/ui/` (12 files, 640 lines) | The design system: primitives, icons, tokens, toasts, the shared clock. | `src/ui/index.ts` (barrel): `src/ui/primitives.tsx` (`Button`, `Chip`, `Card`…), `src/ui/Icon.tsx`, `src/ui/toast.tsx`, `src/ui/useNow.ts`, `src/ui/visibleInterval.ts` (`setVisibleInterval`). | services (1: `src/services/age.ts`); react |
| `src/key/` (8 files, 1131 lines) | The key and licence screens: create, restore, passkey, mint, issue licences, scan and show a key as a QR. | `src/key/index.ts` (barrel: `KeyVault`, `IssueLicences`), `src/key/KeyVault.tsx`, `src/key/IssueLicences.tsx`. | services (6), data (3), chain (2); qrcode, react |
| `src/markdown/` (6 files, 270 lines) | Markdown as the app shows it, reads it aloud and flattens it for previews; Mermaid; bead links. | `src/markdown/index.ts` (barrel): `src/markdown/Markdown.tsx`, `src/markdown/plain.ts` (`markdownToPlain`), `src/markdown/readable.ts`. | ui, router, nav; react-markdown, remark-gfm, mdast |
| `src/push/` (3 files, 337 lines) | A message class becomes a notification (title, options) and a tap becomes a route. Shared with the service worker. | `src/push/index.ts` (barrel), `src/push/classOptions.ts` (`notificationSpecForClass`, `DEFAULT_NOTIFICATION_SETTINGS`), `src/push/tapTarget.ts`. | data (3), nav (2), services (1) |
| `src/licence/` (2 files, 33 lines) | The one "what is a licence?" explainer. | `src/licence/index.ts`: `LicenceExplainer`. | chain (1) |
| `src/chain.ts` (154 lines) | The one seam to the chain: which chain, its screens, its mint cost. Lint-enforced (docs/swapping-the-chain.md). | `chain`, `setChain`, `Chain`, `ChainScreens`. | `src/services/` (chain reads, mint, send, stamp) and `src/key/IssueLicences.tsx` |
| `src/credits.ts` (363 lines) | Every dependency, standard and idea credited; the checks that fail when one is missing. | `CREDIT_GROUPS`, `uncredited`, `staleCovers`, `unnamedFiles`, `goModules`. | nothing |
| `src/sw.ts`, `src/precacheGuard.ts` | The service worker: push per class, tap lands in place, share target, precache. | none (a worker entry); imports `src/push/classOptions.ts` and `src/push/tapTarget.ts`. | push, nav |
| `src/App.tsx`, `src/main.tsx` | The door (set up, unlock once a day) and the place the route names; mounting. | `src/App.tsx`: `App`. | everything above |

`src/services/` sorts, by what its files are for (no folders yet, section 3 refactor 8):
**transport** (`src/services/apiAuth.ts`, `src/services/deliver.ts`, `src/services/live.ts`,
`src/services/inbox.ts`, `src/services/outbox.ts`, `src/services/send.ts`, `src/services/spendable.ts`);
**wire formats** (`src/services/messages.ts`, `src/services/threads.ts`, `src/services/questions.ts`,
`src/services/talk.ts`, `src/services/call.ts`, `src/services/documents.ts`, `src/services/blobs.ts`,
`src/services/attachments.ts`); **key and session** (`src/services/vault.ts`,
`src/services/keySession.ts`, `src/services/session.ts`, `src/services/unlock.ts`,
`src/services/webauthnPrf.ts`, `src/services/licence.ts`); **chain** (`src/services/chainRead.ts`,
`src/services/chainPacer.ts`, `src/services/sharedChainReads.ts`, `src/services/whatsonchain.ts`,
`src/services/confirmedHistory.ts`, `src/services/mint.ts`, `src/services/issue.ts`,
`src/services/stamp.ts`, `src/services/collections.ts`); **voice and keep-awake**
(`src/services/speech.ts`, `src/services/silentLoop.ts`, `src/services/chime.ts`,
`src/services/wakeLock.ts`, `src/services/idleHold.ts`, `src/services/standby.ts`); **the
factory's data on the phone** (`src/services/view.ts`, `src/services/beads.ts`,
`src/services/events.ts`, `src/services/cards.ts`, `src/services/me.ts`, `src/services/prompts.ts`);
**app life** (`src/services/appUpdate.ts`, `src/services/whatsNew.ts`, `src/services/push.ts`,
`src/services/seen.ts`, `src/services/ringIn.ts`, `src/services/presence.ts`).

`src/cockpit/` sorts into **places** (`src/cockpit/NeedsScreen.tsx`, `src/cockpit/MapScreen.tsx`,
`src/cockpit/TalkScreen.tsx`, `src/cockpit/TalkLineScreen.tsx`, `src/cockpit/SearchScreen.tsx`,
`src/cockpit/MeScreen.tsx`, `src/cockpit/BeadScreen.tsx` and the rest of the other Screen files),
**the composer and conversation** (`src/cockpit/Composer.tsx`, `src/cockpit/Conversation.tsx`),
**cards on a place** (`src/cockpit/NeedCard.tsx`, `src/cockpit/LiveCard.tsx`,
`src/cockpit/BeadCards.tsx`) and **hooks** (`src/cockpit/hooks.ts`, `src/cockpit/useTalkLine.ts`,
`src/cockpit/usePrompts.ts`, `src/cockpit/useDraft.ts`).

The intended direction is `cockpit → model, services, ui → data → db`, with `model` pure. Section
4 lists where the code runs the other way.

## 2. Collisions

The fifteen source files changed by the most commits in the last 30 days (769 commits in the period; 229
distinct source files changed). Command, run at the base commit:
`git log --since=30.days --name-only --format= -- src | sort | uniq -c | sort -rn | head -15`.

| Commits | File | Lines |
|---|---|---|
| 29 | `src/cockpit/BeadScreen.tsx` | 457 |
| 28 | `src/data/db.ts` | 399 |
| 26 | `src/cockpit/TalkLineScreen.tsx` | 549 |
| 24 | `src/App.tsx` | 188 |
| 22 | `src/cockpit/NeedCard.tsx` | 346 |
| 22 | `src/cockpit/Conversation.tsx` | 550 |
| 21 | `src/cockpit/TalkScreen.tsx` | 348 |
| 20 | `src/cockpit/useTalkLine.ts` | 310 |
| 18 | `src/key/KeyVault.tsx` | 566 |
| 18 | `src/cockpit/Composer.tsx` | 507 |
| 17 | `src/push/classOptions.ts` | 239 |
| 17 | `src/cockpit/hooks.ts` | 232 |
| 15 | `src/model/conversation.ts` | 307 |
| 14 | `src/services/live.ts` | 438 |
| 14 | `src/services/inbox.ts` | 218 |

What makes each a collision, in one line:

- `src/cockpit/BeadScreen.tsx`: one screen holding five jobs (relations, path grid, actions, details, the thread); every bead feature adds a section here.
- `src/data/db.ts`: every row type, every migration and the class, in one file; any story that stores anything edits it, and a Dexie version bump is a guaranteed conflict between two such stories.
- `src/cockpit/TalkLineScreen.tsx`, `src/cockpit/useTalkLine.ts`, `src/cockpit/TalkScreen.tsx`: the Talk surface (67 commits across three files). The screen carries four hooks and three components that are not the screen.
- `src/App.tsx`: the route-to-screen switch, the startup wiring and two service-worker message listeners; a new place or a new notification tap edits it.
- `src/cockpit/NeedCard.tsx`, `src/cockpit/Conversation.tsx`: both render a question's options and both read aloud; one carries attachments, the other the question block, each in the same file as the screen's own layout.
- `src/key/KeyVault.tsx`: the whole key flow (create, restore, passkey, mint, balance) as one component with its own state machine.
- `src/cockpit/Composer.tsx`: the composer around bsv-kit's hold-to-talk; attachments, drafts, quotes, replies and send all live in it.
- `src/push/classOptions.ts`: a table per notification trait (titles, vibrate, urls, defaults) plus a switch; a new message class edits all of them.
- `src/cockpit/hooks.ts`: every live-query hook for every table.
- `src/model/conversation.ts`, `src/services/live.ts`, `src/services/inbox.ts`: the conversation timeline, the live connection, the record intake; each is one concern, long but not yet split by anything a story would change separately.

## 3. Proposed refactors

Eight, ranked by how much parallel work each frees (commits in the last 30 days on the files it
splits, and how many different kinds of story stop colliding). Each is behaviour-neutral: the gate
passes before and after with the tests unchanged. A story that does one of these is a refactor
story; it changes no feature and no test's expectation.

### 1. Split `src/data/db.ts`: row types per domain, one file per schema step

Frees: every story that stores something (28 commits). **Carve out:** the row types and the
migration steps; leave the class and the `db`.

```ts
// new: src/data/schema/types.ts
import type { Transaction } from 'dexie';
export interface SchemaStep {
  version: number;
  stores: Record<string, string | null>;
  upgrade?: (tx: Transaction) => Promise<void> | void;
}

// new: src/data/schema/steps.ts, one import and one array entry per step, oldest first
export const SCHEMA_STEPS: readonly SchemaStep[];

// new: src/data/rows/messages.ts, outbox.ts, view.ts, cards.ts, vault.ts, settings.ts:
// the row interfaces move unchanged, e.g.
export interface OutboxRow { /* as today */ }

// src/data/db.ts keeps `db` and re-exports every row type, so no importer changes
export function applySchema(db: Dexie, steps: readonly SchemaStep[]): void;
```

**Touches:** `src/data/db.ts`; no importer (16 cockpit files import row types from it). New
files only under the paths above. **Risk:** low-medium. Dexie runs upgrade functions once and needs
versions declared in order; `tests/unit/db-migration.test.ts` already walks the upgrades and must
pass unchanged. **Size:** fits one story.

### 2. Carve the Talk surface into its own folder, cockpit/talk

Frees: the Talk line, the Talk list and channels, read-aloud and the call button, which many
stories edit (67 commits across `src/cockpit/TalkLineScreen.tsx`,
`src/cockpit/TalkScreen.tsx`, `src/cockpit/useTalkLine.ts`). **Carve out:** from
`src/cockpit/TalkLineScreen.tsx` the scroll hooks `useFollowEnd` and `useEarlierTalks`, `useReadAloud`,
`CallMe`, `TalkTurnItem`; from `src/cockpit/TalkScreen.tsx` `ThreadList`, `ThreadRow`, `NewChannel`,
`ChannelPane`, `RepliesPane`. Each screen file ends under 200 lines.

```ts
// new: src/cockpit/talk/useFollowEnd.ts
export function useFollowEnd(log: TalkLogEntry[]): {
  scroller: RefObject<HTMLDivElement>;
  onScroll: () => void;
  onTouch: () => void;
  pill: boolean;
  showNew: () => void;
};

// new: src/cockpit/talk/useEarlierTalks.ts
export function useEarlierTalks(earlier: EarlierTalk[], scroller: RefObject<HTMLDivElement | null>): {
  shown: EarlierTalk[];
  hidden: number;
  loadEarlier: () => void;
  onScrolled: () => void;
};

// new: src/cockpit/talk/useReadAloud.ts
export function useReadAloud(): { playing?: string; toggle: (key: string, text: string) => void; supported: boolean };

// new: src/cockpit/talk/CallMe.tsx, TalkTurnItem.tsx, ThreadList.tsx, ChannelPane.tsx
export function CallMe(props: { open: boolean; onClose: () => void }): JSX.Element | null;
export function TalkTurnItem(props: { entry: TalkLogEntry; talkId: string; marks?: ReactNode; earlier?: boolean; reader: ReadAloud }): JSX.Element;
export function ThreadList(props: { threads: ThreadSummary[]; current?: string; filter: string; onToggleArchive: (thread: ThreadSummary) => void }): JSX.Element;

// new: src/cockpit/talk/index.ts, the one entry the two screens import
```

**Touches:** `src/cockpit/TalkLineScreen.tsx`, `src/cockpit/TalkScreen.tsx`, `src/cockpit/useTalkLine.ts`
(moved into the folder, with the old path re-exporting it until imports are updated); the Talk
feature steps and unit tests import the screens and keep working. **Risk:** medium: `jsdom` tests of
scroll behaviour (`TZ=UTC npm test`) and the 360 px and 390 px Playwright specs are the guard, and
the shots project flakes under load (rig memory). **Size:** does not fit one story; split in two:
the Talk line files first, then the Talk list and channels.

### 3. Split `src/cockpit/BeadScreen.tsx` into sections behind a registry

Frees: every bead-page story (29 commits, the most-changed file). **Carve out:** `RelationChips`,
`PathGrid`, `Actions`, `Details` and the thread into one file each, plugged into a list; a new
section is a new file and one line.

```ts
// new: src/cockpit/bead/types.ts
export interface BeadContext {
  id: string;
  bead?: ViewBead;
  detail?: BeadDetail;
  index?: ViewIndex;
  status: DetailStatus;
}
export interface BeadSection {
  id: string;
  order: number;
  visible: (ctx: BeadContext) => boolean;
  Section: (ctx: BeadContext) => JSX.Element;
}

// new: src/cockpit/bead/sections.ts
export const BEAD_SECTIONS: readonly BeadSection[];
```

**Touches:** `src/cockpit/BeadScreen.tsx` (becomes about 100 lines: fetch, header, map over
`BEAD_SECTIONS`); `src/cockpit/hooks.ts` is read, not edited. **Risk:** low: the order of sections is
the visible behaviour, and the existing bead feature steps assert it. **Size:** fits one story.

### 4. One question-options module for `src/cockpit/Conversation.tsx` and `src/cockpit/NeedCard.tsx`

Frees: the two most-edited card surfaces from each other (44 commits) and ends a divergence (section
4). **Carve out:** option parsing and rendering (letter, label, spoken form, short-or-long layout)
into one module both import; and attachments out of `src/cockpit/Conversation.tsx`.

```ts
// new: src/cockpit/question/options.ts (pure; the one parser)
export interface ParsedOption { letter?: string; label: string }
export function parseOption(option: string): ParsedOption;
export function spokenOption(option: string): string;

// new: src/cockpit/question/OptionLabel.tsx
export function OptionLabel(props: { option: string }): JSX.Element;

// new: src/cockpit/conversation/Attachments.tsx
export function AttachmentList(props: { attachments: Attachment[]; direction: 'sent' | 'received' }): JSX.Element;
```

**Touches:** `src/cockpit/Conversation.tsx`, `src/cockpit/NeedCard.tsx` (and the two option
helpers they each define). **Risk:** medium: the two regular expressions differ (`NeedCard` accepts
`A:` with no space and capitals only; `Conversation` needs a space and accepts one or two letters or
digits), so merging them changes what a malformed option looks like; settle which is right in a
scenario first. **Size:** fits one story if attachments stay a second one.

### 5. `src/App.tsx`: a route table and a service-worker bridge

Frees: "add a place" and "add a notification tap" stories (24 commits). **Carve out:** the
`switch` in `Place` into a table keyed by `Route['view']`, and the two `navigator.serviceWorker`
message listeners (open, seen?, later) into one service.

```ts
// new: src/cockpit/places.tsx
export type PlaceRenderer<V extends Route['view']> = (route: Extract<Route, { view: V }>) => JSX.Element;
export const PLACES: { [V in Route['view']]?: PlaceRenderer<V> };

// new: src/services/swBridge.ts
export interface SwBridgeHandlers {
  open: (url: string) => void;
  seen: (txid: string) => Promise<boolean>;
  later: (ringTxid: string) => Promise<void>;
}
export function startSwBridge(handlers: SwBridgeHandlers): () => void;
```

**Touches:** `src/App.tsx`, `src/services/seen.ts`, `src/cockpit/send.ts` (callers of the handlers).
**Risk:** low-medium: the `Place` keys that reset a screen when a parameter changes
(`key={route.id}` on bead and notice) must survive the move. **Size:** fits one story.

### 6. `src/key/KeyVault.tsx`: lift the flow out of the component

Frees: key, passkey and licence stories (18 commits) and `src/key/IssueLicences.tsx`. **Carve out:**
the screen state machine and `determineLicenceState`, `storePhraseWrapped` and `storeKey` into a
hook and services; the component only draws. Do this after library candidate 1 in section 5, since
moving the vault onto bsv-kit deletes much of it.

```ts
// new: src/key/useKeyFlow.ts
export function useKeyFlow(): {
  screen: Screen; // the existing union: loading, empty, reveal, restore, locked, unlocked
  licence: LicenceState;
  balance: BalanceState;
  create: () => Promise<void>;
  restore: (phrase: string) => Promise<void>;
  mint: () => Promise<MintOutcome>;
};

// new: src/services/licenceState.ts
export function determineLicenceState(publicKeyHex: string): Promise<LicenceState>;
```

**Touches:** `src/key/KeyVault.tsx`, `src/services/licence.ts`, `src/services/vault.ts`.
**Risk:** medium: this is the key screen, the one place the Governor cannot undo a slip; the
existing key scenarios must pass untouched. **Size:** does not fit one story if the vault also moves;
the hook alone fits.

### 7. A notification class registry for `src/push/classOptions.ts`

Frees: every new message class (17 commits; today a class is a line in five tables). **Carve out:**
one definition per class, registered, with the tables derived.

```ts
// new: src/push/classes/types.ts
export interface NotificationClassDef {
  id: PushClass;
  title: string;
  vibrate: number[];
  defaults: ClassNotificationSettings;
  url: (txid: string, text: NotificationText) => string;
  tag: (txid: string) => string | undefined;
  renotify?: boolean;
}

// new: src/push/classes/index.ts
export const CLASSES: readonly NotificationClassDef[];
export function classDef(id: PushClass): NotificationClassDef;
```

**Touches:** `src/push/classOptions.ts`, `src/data/repositories/settings-repo.ts` (reads
`DEFAULT_NOTIFICATION_SETTINGS`), `src/sw.ts`. **Risk:** low, with the existing
`classOptions` unit tests as the guard; the service worker bundle must still import it without the
app. **Size:** fits one story.

### 8. Split `src/cockpit/hooks.ts` by domain

Frees: view, message, card and outbox stories from each other (17 commits). **Carve out:** the
hooks by table. The file becomes a folder with the same name (an entry file inside it), so no importer
changes.

```ts
// new: src/cockpit/hooks/index.ts re-exports every hook it holds today, unchanged, e.g.
export { useLiveQuery } from './useLiveQuery';  // function useLiveQuery<T>(query: () => Promise<T>, deps: unknown[], initial: T): T
export { useViewIndex, useBeadTitles, useBeadDetail } from './view';
export { useMessages, useTalkTurns, useThreadMessages } from './messages';  // function useMessages(): MessageRow[]
export { useCards, useCardArchive } from './cards';
export { useEmergency, useRecentEmergencies } from './emergency';

// new: src/cockpit/hooks/emergency.ts
export function useEmergency(): EventRow | undefined;
export function useRecentEmergencies(limit?: number): EventRow[] | undefined;
```

**Touches:** `src/cockpit/hooks.ts` only. **Risk:** very low: `import … from './hooks'` resolves to
its entry file; remove the file in the same commit. **Size:** fits one story;
do it first if a quick win is wanted.

**Considered and not proposed as a story yet.** *Folders and barrels for `src/services/`* (57 flat
files, the cockpit imports 36 of them by name): worth doing, but moving files rewrites about 85 import
lines in 60 files and collides with every open story, so it needs a quiet window and one
subfolder per story (voice first: `src/services/speech.ts` and friends, because library candidate 2
takes them out anyway). *A pure protocol layer* so `src/model/` stops importing `src/services/`
(section 4): move the decoders of `src/services/threads.ts`, `src/services/questions.ts`,
`src/services/talk.ts` and `src/services/call.ts` into a new pure module that `model`, `data` and
`services` all import; fits one story, and is the first thing to do before refactor 1 if a cycle
shows up.

## 4. Rule breaks

Where the code breaks a rule of Modular Boundaries (rule 27) or its sibling rules, at the base commit.

- **No interface for the screens to talk to.** `src/cockpit/`, `src/model/`, `src/services/` and `src/nav/` have no entry file; the cockpit has 85 import lines from 36 service files, 84 from the model files and 28 from the data files, all naming the file itself, so any internal rename is a change in every screen. The rule: "give each concern its own folder with one entry file that exports the interface and hides the rest". Only `src/ui/`, `src/key/`, `src/markdown/`, `src/push/`, `src/licence/` and `src/data/repositories/` have one.
- **The model is not pure.** `src/model/call.ts`, `src/model/conversation.ts`, `src/model/needs.ts`, `src/model/cards.ts`, `src/model/threads.ts` and `src/model/talkLog.ts` import decoders from `src/services/`; `src/model/conversation.ts`, `src/model/threads.ts`, `src/model/shareText.ts` import from `src/markdown/`. The service layer imports the model back (19 import lines), so the two form a cycle in practice.
- **The database layer imports upward.** `src/data/db.ts` imports `src/model/twins.ts`; `src/data/repositories/settings-repo.ts` imports `src/push/classOptions.ts`; `src/data/repositories/drafts-repo.ts` imports `src/services/threads.ts`; `src/data/repositories/cards-repo.ts` imports `src/model/cards.ts`. A repository should depend on nothing but its row type.
- **A screen reaches a browser API directly.** `src/cockpit/EmergencyBanner.tsx` calls `navigator.serviceWorker.ready`; `src/App.tsx` registers two service-worker message listeners and runs the retry timer. Both belong behind a service (refactor 5). `src/key/Scanner.tsx` calls `getUserMedia` itself (a camera seam; one user today, so noted, not urgent).
- **Chain constants live in screens.** `src/key/KeyVault.tsx` and `src/key/IssueLicences.tsx` each define `WHATSONCHAIN_TESTNET_TX_URL`, and `src/services/stamp.ts` builds the same URL a third way. `src/chain.ts` already exports `explorerUrl` (from `src/services/stamp.ts`), so both screens can drop their constant; the explorer link belongs to the chain seam, which is also what makes the chain switch (testnet to mainnet) one edit.
- **A language constant in code.** `src/key/IssueLicences.tsx`, `src/key/KeyVault.tsx` and `src/licence/LicenceExplainer.tsx` format numbers and dates with a literal `'en-US'` or `'en-GB'` (and two different ones for dates and sats in one file). The rule says the language comes from settings; `readingLang()` in `src/services/speech.ts` already does for speech. One `formatNumber` and `formatDate` over the phone's language would fix all of them.
- **A model name in a screen.** `src/cockpit/TalkLineScreen.tsx` holds the model picker's list (`MODELS`: Opus, Sonnet, Fable) as a constant. The rule: "language, book, voice and model are data or settings". The list should come from settings, or from the Mayor's host if it can say which models it offers.
- **The same text rendered two ways.** Option labels: `src/cockpit/Conversation.tsx` (`OptionLabel`) and `src/cockpit/NeedCard.tsx` (`optionLabel`, `spokenOption`) parse an option with different regular expressions. Refactor 4.
- **Duplicates of bsv-kit.** Postern keeps its own copy of what bsv-kit's bsv package ships: `src/services/apiAuth.ts` (the signed door: `NONCE_SHAPE`, `withTimeout`, `API_TIMEOUT_MS`, `RefusedError`, `BackendUnreachableError`, `ApiTimeoutError`, `isPermanentRefusal` all have a twin in the door of bsv-kit); `src/services/vault.ts`, `src/services/keySession.ts` and `src/services/session.ts` (bsv-kit's vault: `createMnemonic`, `wrap`/`unwrap`, `createKeySession`, `SESSION_HOURS`); `src/services/licence.ts`, `src/services/whatsonchain.ts`, `src/services/chainRead.ts` (bsv-kit's licence: `licenceStatus`, `WhatsOnChainReader`). Postern depends on bsv-kit only for the composer and What's new, and on `spell-forge-bsv` for the chain pieces. The rule says the same code in two apps is one library; this is the largest single duplicate in the rig (library candidate 1).
- **Duplicates between apps outside bsv-kit.** `src/ui/visibleInterval.ts` and `src/services/wakeLock.ts` have twins in Lampas (src/ui/visibleInterval.ts, src/speech/wakeLock.ts); `src/services/speech.ts` has two more (Lampas src/speech/readAloud.ts, SpellForge src/audio/speech.ts); the credits checks in `src/credits.ts` have two more (trade-tracker src/content/credits-check.ts, SpellForge tests/fixtures/credits-check.ts). Library candidates 2 and 3.
- **Files past the 500-line trigger.** The rule: past about 500 lines, propose a split. Over it: `src/key/KeyVault.tsx` (566), `src/cockpit/Conversation.tsx` (550), `src/cockpit/TalkLineScreen.tsx` (549), `src/cockpit/Composer.tsx` (507). Covered by refactors 2, 4 and 6; `src/cockpit/Composer.tsx` has no refactor here because most of it is bsv-kit's composer wiring (the library already owns the hard part), and a split would be a guess until the next story shows which part changes.

## 5. Library candidates

Code another app could use, or already copies. Rules that apply to all (library best practices
4, 5, 8): the library is a public repo with nothing of the Governor's in it; a package under 1.0
raises the minor version for a breaking change; every release has a tag equal to its
`package.json` version and a CHANGELOG entry that lists breaking changes first; each app pins the
tag (the full commit while no tag exists); each app moves onto the library in its own story that
deletes its copy; and a wire-format change keeps both formats for a window (rule 05). Postern pins
bsv-kit by commit today (`package.json`).

### 1. The door, the vault and the licence reader: finish the move onto bsv-kit's bsv package

**Belongs in:** bsv-kit, packages/bsv (it exists; `door`, `vault`, `licence` are its three
namespaces). **What moves:** Postern's own `src/services/apiAuth.ts`, `src/services/vault.ts`,
`src/services/keySession.ts`, `src/services/session.ts`, `src/services/licence.ts`,
`src/services/whatsonchain.ts` become thin adapters over it, then are deleted. **Proposed public
API (already shipped, so nothing new to design):**

```ts
import { door, vault, licence } from '@bsv-kit/bsv';
declare const d: door.Door;                                    // signs each /api call with a fresh challenge
declare function createKeySession(options?: vault.KeySessionOptions): vault.KeySession;
declare function licenceStatus(reader: licence.ChainReader, address: string, options?: licence.LicenceOptions): Promise<licence.LicenceStatus>;
declare class WhatsOnChainReader implements licence.ChainReader {}
```

**Versioning:** a pin bump, no new version: the move needs the version Postern pins to already
contain the three namespaces (check the pinned commit, since the checkout at
`/home/jwhite/bsv-kit` is behind it). The one real risk is wire: Postern's `apiFetch` signs the
challenge on every call (docs/api.md); confirm bsv-kit's `Door` produces the byte-identical header
before deleting Postern's copy, as rule 05 asks, and keep Postern's `src/services/apiAuth.ts` test
as the contract test. **Size:** one story per concern (door; vault and session; licence), after
refactor 6 if the key flow is also being moved.

### 2. Read aloud: a NEW public library, voice-kit

**Belongs in:** a new public repo Jonathan-A-White/voice-kit, package voice-kit/speak; bsv-kit is
named for the chain and Postern's speech has no chain in it. Three copies today (Postern
`src/services/speech.ts` 307 lines, Lampas src/speech/readAloud.ts 296, SpellForge src/audio/speech.ts
481). The hold-to-talk listening side already lives in bsv-kit's composer package; when voice-kit
exists, move the shared recogniser pieces there at a major bump rather than keeping speak and
listen in two libraries. **Proposed public API** (Postern's, with the language an argument, never a constant):

```ts
export interface SpeakOptions { key?: string; titles?: TitleLookup; lang?: string; voice?: string }
export type SpeechStatus = 'idle' | 'playing' | 'paused';
export interface SpeechState { status: SpeechStatus; key?: string }
export function isSupported(): boolean;
export function readingLang(): string;
export function speak(text: string, options?: SpeakOptions): void;
export function pause(): void;
export function resume(): void;
export function restart(): void;
export function stop(): void;
export function subscribe(listener: () => void): () => void;
export function getSpeech(): SpeechState;
```

and a voice-kit/testing entry with a fake `speechSynthesis` (library rule 06: shipped fakes).
**Versioning:** start at 0.1.0 with a tag and CHANGELOG; the sentence queue (one utterance per
sentence, `src/services/speech.ts`) is part of the contract and a test of it ships; 0.x minors may
break, and each break is listed first in the CHANGELOG. **Size:** library first (one story: the
Postern code lifted with its tests), then one adoption story per app.

### 3. Small PWA parts: a NEW public library, pwa-kit

**Belongs in:** a new public repo Jonathan-A-White/pwa-kit with subpath entries, each a few dozen
lines, none of them chain-aware: pwa-kit/visible-interval (Postern `src/ui/visibleInterval.ts`;
twin in Lampas), pwa-kit/wake-lock (Postern `src/services/wakeLock.ts`; twin in Lampas),
pwa-kit/credits (the checks in `src/credits.ts`: `uncredited`, `staleCovers`, `unnamedFiles`,
`goModules`; three more copies in trade-tracker, SpellForge and bsv-kit), and, when a second app
needs them, pwa-kit/nav (Postern `src/nav/lastRoute.ts` and `src/nav/scrollMemory.ts`: reopen where
he left, scroll position on Back; Lampas may have partial twins: unverified). **Proposed public API:**

```ts
export function setVisibleInterval(fn: () => void, ms: number): () => void;
export function holdAwake(): () => void;
export interface Credit { name: string; url: string; covers?: string[]; files?: string[] }
export function uncredited(credits: readonly Credit[], dependencies: readonly string[]): string[];
export function staleCovers(credits: readonly Credit[], declared: readonly string[]): string[];
export function unnamedFiles(credits: readonly Credit[], files: readonly string[]): string[];
```

(the credits functions take the credit list as an argument; today Postern's read a module-level
constant). **Versioning:** 0.1.0, one tag, a subpath is its own stability promise: only a removed
or changed export is breaking; a new subpath is a minor. The credits check is the one with
cross-app weight: the Governor's credits rule (rule 29) is checked in four places that already
drift, so the first adoption story is bsv-kit's and Postern's. **Size:** library fits one story;
adoption is one story per app.

**Not yet: the outbox, the Markdown renderer, the notification classes.** `src/services/outbox.ts` (a write-first, send-in-order, acked queue), `src/markdown/` (GitHub-
flavoured Markdown, Mermaid, bead links) and `src/push/classOptions.ts` each have exactly one user.
The second-copy rule says to wait for a second app; when one asks, the outbox is the best next
candidate (a `bsv-kit` or `pwa-kit` package named `outbox`, its API `enqueue(row)`, `startOutbox()`,
`retryRow(id)`, `discardRow(id)`, with the row type a generic over the payload), and its row type
is today wired to Postern's own `OutboxKind` in `src/data/db.ts`, so refactor 1 comes first.

## 6. Keeping this map true

A Builder whose story adds a folder under `src/`, a barrel, or a new seam names it here in the same
commit; one whose closing comment proposes a split (a file past 500 lines, or a third story in a
row on one file) adds it to section 3. The last re-count of section 2 was 2026-10-09; the command
is in that section.
