# postern

Building an app like this one? Start with [docs/best-practices.md](docs/best-practices.md): the
front end, the back end, and how to run without the chain.
To use another chain, or none, see [docs/swapping-the-chain.md](docs/swapping-the-chain.md).
For what the code is made of, the files stories collide on and the splits that would let them run in parallel, see [docs/module-map.md](docs/module-map.md).

Postern is the Governor's cockpit for his software factory: one place to see what needs
him, the whole wayfinder map at any zoom, and every channel with the Mayor — by
text, voice, screenshots and files, pinned to the factory, a map, an epic, a story or a
single comment. It is an offline-first PWA (Vite, React, TypeScript, Dexie), served at
https://postern.allmymind.org, with a small Go backend under `server/` that runs beside
the factory on the desktop. BSV gives it identity and a licence gate; messages travel
end-to-end encrypted over a live connection (docs/protocol.md §9–§16). Plan:
vault `plans/0021-cockpit-plan.md`; demo: `docs/demo-cockpit.md`. Map: mw-f758y.

## Saved prompts

The **Prompts** screen (on Me, and from the Talk line) lists the Mayor's saved prompts with
their name, summary and options. **Run** opens the composer with `/name ` filled in; **Edit**
opens the channel `prompt:<name>`, a text conversation with the Mayor about it. In the composer,
typing `/` offers the prompts by name; choosing one inserts it, and a call such as
`/top5 --duration 15m` is checked against the prompt's options before Send (an unknown prompt
or a bad option shows an error and Send stays off). A good call goes as an ordinary message.
A **Talk** button on every card, hands step, thread and Prompts row opens the Talk line about
that thing. Protocol: docs/protocol.md §20 and §23.

## Needs you: live cards

**Needs you** shows live cards: the Mayor's answer to a saved prompt such as `/top5` can be one
card, a numbered list whose items link to the beads where he goes and does the thing, and which
ticks itself off as the factory's events arrive. An open card sits under You (`Cards · N`) and
in its bead's channel; once every item is done it moves under `Done · N`. The Mayor can update
a card in place, so a link may appear later. Protocol: docs/protocol.md §24.

## Screenshots

A Builder runs `npm run shots` on demand (never in the gate) to capture every `tests/e2e/` spec's
screen at a 390px phone width into `test-results/shots/`. `npm run shots:publish -- <story-id>`
then rsyncs those into the story's own set. Sets land at
`https://postern.allmymind.org/shots/<story-id>/<name>.png`, with only the newest 30 stories' sets
kept on the VPS.

## Credits

> If I have seen further it is by standing on the shoulders of Giants.
> — Isaac Newton, letter to Robert Hooke, 1675

We credit everyone we build on, whether or not a licence asks us to, because what Postern can do it can do on their work. The same list is on the About screen (Me, then About and credits); its source is [src/credits.ts](src/credits.ts), and a test fails when a dependency in `package.json` or `server/go.mod` is missing from it.

A source added or removed changes its credit in the same commit, and the test says so: it fails for a dependency with no credit, for a credit naming a package that is no longer a dependency, and for a bundled font or data file (`public/`, or font and data files in `src/`) that no credit names.

### Ideas and the people who had them

- [Beads](https://github.com/steveyegge/beads): Steve Yegge's issue tracker for AI agents: its beads are the stories, epics and decisions Postern's map, cards and bead pages show. Licence: [MIT](https://github.com/steveyegge/beads/blob/main/LICENSE). Changes: None to Beads itself; Postern only reads and shows the factory's beads.
- [Gas Town](https://github.com/steveyegge/gastown): Steve Yegge's multi-agent workspace manager: the idea of a Mayor who coordinates and workers who each take one piece of work is the shape of the factory Postern is the phone for. Licence: [MIT](https://github.com/steveyegge/gastown/blob/main/LICENSE). Changes: We took the ideas, not the code, and bent them to our own factory (millwright).
- [Claude Code](https://claude.com/product/claude-code): Anthropic's coding agent: it wrote and tested this app, and it is the Mayor and the Builders the Governor talks to through it. Licence: [Anthropic Commercial Terms](https://www.anthropic.com/legal/commercial-terms). Changes: None; it is a tool we work with, not code we ship.
- [SpellForge](https://github.com/Jonathan-A-White/spell-forge): The Governor's earlier app, whose stack (React, TypeScript, Vite, Tailwind, Dexie, vitest) and licence-gate pattern Postern follows. Licence: [MIT](https://github.com/Jonathan-A-White/spell-forge/blob/main/LICENSE). Changes: Its patterns were reworked for Postern; its chain package is credited below.
- [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki): The Bitcoin Improvement Proposal by Marek Palatinus, Pavol Rusnak, Aaron Voisine and Sean Bowe that defines the twelve-word recovery phrase your key is made from. Licence: [MIT](https://spdx.org/licenses/MIT.html). Changes: None; implemented by scure-bip39, below.

### Outside services and standards

- [WhatsOnChain](https://whatsonchain.com): The public API Postern uses to read the BSV chain and to send to it: the licence check, the balance and the transactions that carry the messages. Licence: [WhatsOnChain terms of use](https://whatsonchain.com/terms). Changes: None; we call its public API as published, and pace the calls so as not to burden it.
- [BSV blockchain](https://bitcoinsv.io): The chain that gives Postern its identity and licence and carries its end-to-end encrypted messages. Licence: [Open BSV License](https://github.com/bsv-blockchain/ts-stack/blob/main/packages/sdk/LICENSE.txt). Changes: None; we use the testnet until the Governor says mainnet.
- [Web Push and VAPID](https://www.rfc-editor.org/rfc/rfc8292): The IETF standards (RFC 8030, RFC 8292) behind the notifications that reach your phone through the browser maker's push service. Licence: [IETF Trust Legal Provisions](https://trustee.ietf.org/license-info/IETF-TLP-5.htm). Changes: None; implemented by webpush-go, below.
- [Web Speech API](https://webaudio.github.io/web-speech-api/): The W3C draft behind the voice features: the phone's own speech recogniser hears you on the Talk line and the hold-to-talk button, and its speech synthesiser reads messages aloud. The engine is the browser's, which may be a cloud service run by the browser's maker; Postern bundles no speech model. Licence: [W3C Software and Document License](https://www.w3.org/copyright/software-license/). Changes: None; we only call it.
- [MediaRecorder API](https://w3c.github.io/mediacapture-record/): The W3C standard that records the voice notes you send, in the Opus format where the browser has it. Licence: [W3C Software and Document License](https://www.w3.org/copyright/software-license/). Changes: None; we only call it.
- [Opus](https://opus-codec.org): The audio codec (RFC 6716, from Xiph.Org, Skype and the IETF) the voice notes are recorded in. Licence: [BSD-3-Clause](https://opus-codec.org/license/). Changes: None; the browser carries the codec, not us.
- [Web Authentication](https://www.w3.org/TR/webauthn-3/): The W3C standard behind the passkey that can unlock your key on this phone. Licence: [W3C Software and Document License](https://www.w3.org/copyright/software-license/). Changes: None; we only call it.

### Libraries that run in the app

- [React](https://react.dev): The interface: every screen you see. Licence: [MIT](https://spdx.org/licenses/MIT.html). Changes: None; used as published.
- [BSV SDK](https://github.com/bsv-blockchain/ts-stack/tree/main/packages/sdk): Keys, signatures and transactions on the BSV chain. Licence: [Open BSV License version 4](https://github.com/bsv-blockchain/ts-stack/blob/main/packages/sdk/LICENSE.txt). Changes: None; used as published.
- [spell-forge-bsv](https://github.com/Jonathan-A-White/spell-forge): The chain package from SpellForge: the licence check and the chain provider behind Postern's gate. Licence: [MIT](https://github.com/Jonathan-A-White/spell-forge/blob/main/LICENSE). Changes: None; used as published.
- [bsv-kit](https://github.com/Jonathan-A-White/bsv-kit): The Governor's shared library: the hold-to-talk composer (the bar, the recogniser and its fallbacks, the voice recorder) that Postern's composer and Talk line are built on, What's new (the Update ready summary, the sheet after an update, the list of versions and the Check for updates button), and the honest speech and microphone fakes its tests run against. Licence: [MIT](https://github.com/Jonathan-A-White/bsv-kit/blob/main/LICENSE). Changes: None; used as published.
- [scure-bip39](https://paulmillr.com/noble/#scure): Paul Miller's audited BIP-39 library: makes and checks the recovery phrase. Licence: [MIT](https://spdx.org/licenses/MIT.html). Changes: None; used as published.
- [Dexie](https://dexie.org): The database in your phone's browser where messages, the view and the outbox are kept. Licence: [Apache-2.0](https://spdx.org/licenses/Apache-2.0.html). Changes: None; used as published.
- [Postern's icon](https://github.com/Jonathan-A-White/postern/blob/main/public/icon.svg): The picture on the home-screen icon and in the browser tab (public/icon.svg), drawn for Postern. Licence: [MIT](https://github.com/Jonathan-A-White/postern/blob/main/LICENSE). Changes: None; it is our own drawing.
- [Postern's changelog](https://github.com/Jonathan-A-White/postern/blob/main/public/changelog.json): The list of what changed in each version (public/changelog.json, the same lines as CHANGELOG.md) that What's new shows. Licence: [MIT](https://github.com/Jonathan-A-White/postern/blob/main/LICENSE). Changes: None; it is our own writing.
- [Mermaid](https://github.com/mermaid-js/mermaid): Draws the diagrams that appear in messages. Licence: [MIT](https://spdx.org/licenses/MIT.html). Changes: None; used as published.
- [node-qrcode](https://github.com/soldair/node-qrcode): Draws the QR code for your public key. Licence: [MIT](https://spdx.org/licenses/MIT.html). Changes: None; used as published.
- [react-markdown](https://github.com/remarkjs/react-markdown): Shows the Markdown in messages and bead pages as formatted text. Licence: [MIT](https://spdx.org/licenses/MIT.html). Changes: None; used as published.
- [remark-gfm](https://github.com/remarkjs/remark-gfm): Adds tables, task lists and strikethrough to that Markdown. Licence: [MIT](https://spdx.org/licenses/MIT.html). Changes: None; used as published.
- [Workbox](https://github.com/GoogleChrome/workbox): Keeps the app's files on your phone so it opens offline. Licence: [MIT](https://spdx.org/licenses/MIT.html). Changes: None; used as published.

### The backend, written in Go

- [Go](https://go.dev): The language and standard library the backend beside the factory is written in. Licence: [BSD-3-Clause](https://go.dev/LICENSE). Changes: None; used as published.
- [webpush-go](https://github.com/SherClockHolmes/webpush-go): Sends the push notifications. Licence: [MIT](https://spdx.org/licenses/MIT.html). Changes: None; used as published.
- [btcec](https://github.com/btcsuite/btcd/tree/master/btcec): btcsuite's secp256k1 library: checks the signatures on every request. Licence: [ISC](https://spdx.org/licenses/ISC.html). Changes: None; used as published.
- [dcrd secp256k1](https://github.com/decred/dcrd/tree/master/dcrec/secp256k1): The Decred developers' secp256k1 code that btcec is built on. Licence: [ISC](https://spdx.org/licenses/ISC.html). Changes: None; used as published.
- [golang-jwt](https://github.com/golang-jwt/jwt): Signed tokens, brought in by webpush-go for its VAPID headers. Licence: [MIT](https://github.com/golang-jwt/jwt/blob/main/LICENSE). Changes: None; used as published.
- [Go x/crypto](https://pkg.go.dev/golang.org/x/crypto): The Go team's supplementary cryptography: encryption and key derivation. Licence: [BSD-3-Clause](https://go.googlesource.com/crypto/+/refs/heads/master/LICENSE). Changes: None; used as published.
- [nginx](https://nginx.org): Serves the app at postern.allmymind.org and passes the API through to the backend. Licence: [BSD-2-Clause](https://nginx.org/LICENSE). Changes: None; only configured.

### Tools that build and test it

- [Vite](https://vite.dev): Builds the app from its source. Licence: [MIT](https://spdx.org/licenses/MIT.html). Changes: None; used as published.
- [Tailwind CSS](https://tailwindcss.com): Styles every screen from the design tokens. Licence: [MIT](https://spdx.org/licenses/MIT.html). Changes: None; used as published.
- [vite-plugin-pwa](https://github.com/vite-pwa/vite-plugin-pwa): Turns the build into an installable app with its service worker. Licence: [MIT](https://spdx.org/licenses/MIT.html). Changes: None; used as published.
- [TypeScript](https://www.typescriptlang.org): The language the app is written in, and its type checker. Licence: [Apache-2.0](https://spdx.org/licenses/Apache-2.0.html). Changes: None; used as published.
- [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped): The type definitions for React, Node and qrcode. Licence: [MIT](https://spdx.org/licenses/MIT.html). Changes: None; used as published.
- [tsx](https://tsx.hirok.io): Runs the TypeScript scripts, such as the fixture generator. Licence: [MIT](https://spdx.org/licenses/MIT.html). Changes: None; used as published.
- [ESLint](https://eslint.org): Catches mistakes and keeps the code to its rules. Licence: [MIT](https://spdx.org/licenses/MIT.html). Changes: None; used as published.
- [typescript-eslint](https://typescript-eslint.io): Lets ESLint read TypeScript. Licence: [MIT](https://spdx.org/licenses/MIT.html). Changes: None; used as published.
- [eslint-plugin-react-hooks](https://react.dev): The React team's lint rules for hooks. Licence: [MIT](https://spdx.org/licenses/MIT.html). Changes: None; used as published.
- [eslint-plugin-react-refresh](https://github.com/ArnaudBarre/eslint-plugin-react-refresh): Lint rules that keep hot reloading working. Licence: [MIT](https://spdx.org/licenses/MIT.html). Changes: None; used as published.
- [Vitest](https://vitest.dev): Runs the unit tests and the feature scenarios. Licence: [MIT](https://spdx.org/licenses/MIT.html). Changes: None; used as published.
- [vitest-cucumber](https://github.com/amiceli/vitest-cucumber): Runs the Gherkin scenarios under features/ as Vitest tests. Licence: [ISC](https://spdx.org/licenses/ISC.html). Changes: None; used as published.
- [Testing Library](https://testing-library.com): Tests the screens the way a person uses them (React Testing Library, user-event and jest-dom). Licence: [MIT](https://spdx.org/licenses/MIT.html). Changes: None; used as published.
- [jsdom](https://github.com/jsdom/jsdom): A browser stand-in for the unit tests. Licence: [MIT](https://spdx.org/licenses/MIT.html). Changes: None; used as published.
- [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB): A stand-in for the browser's database in the tests. Licence: [Apache-2.0](https://spdx.org/licenses/Apache-2.0.html). Changes: None; used as published.
- [Playwright](https://playwright.dev): Drives a real browser through the app for the end-to-end tests and the screenshots. Licence: [Apache-2.0](https://spdx.org/licenses/Apache-2.0.html). Changes: None; used as published.

Postern ships no font files and no icon library: the text uses your phone's own system fonts, and the icons are small stroke shapes drawn inline for Postern.

## Licence

The code is released under the MIT licence; see [LICENSE](LICENSE). (This is the licence of the source code, not the Postern licence a key holds.)
