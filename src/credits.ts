// src/credits.ts — everything Postern is built on, by name, with a link, what it is used
// for, its licence (with a link) and what we changed (mw-vtjxh4.3). The About screen shows
// this list and the README's Credits section repeats it; tests/unit/credits.test.ts fails
// when a dependency in package.json or server/go.mod is covered by no credit, so adding a
// library means crediting it in the same commit.

export interface Credit {
  /** The name, which is the link text: never an address (a long address breaks mid-word on a phone). */
  name: string;
  url: string;
  /** What Postern uses it for. */
  use: string;
  licence: string;
  licenceUrl: string;
  /** What we changed in it ('None' when we use it as published). */
  changes: string;
  /** The package.json packages and server/go.mod modules this credit stands for. */
  covers?: string[];
}

export interface CreditGroup {
  id: string;
  title: string;
  credits: Credit[];
}

export const NEWTON = {
  quote: 'If I have seen further it is by standing on the shoulders of Giants.',
  by: 'Isaac Newton',
  source: 'letter to Robert Hooke, 1675',
};

export const WHY_WE_CREDIT = 'We credit everyone we build on, whether or not a licence asks us to, because what Postern can do it can do on their work.';

export const FONTS_AND_ICONS =
  "Postern ships no font files and no icon library: the text uses your phone's own system fonts, and the icons are small stroke shapes drawn inline for Postern.";

const MIT = { licence: 'MIT', licenceUrl: 'https://spdx.org/licenses/MIT.html' };
const APACHE = { licence: 'Apache-2.0', licenceUrl: 'https://spdx.org/licenses/Apache-2.0.html' };
const ISC = { licence: 'ISC', licenceUrl: 'https://spdx.org/licenses/ISC.html' };
const BSD3 = { licence: 'BSD-3-Clause', licenceUrl: 'https://spdx.org/licenses/BSD-3-Clause.html' };
const AS_PUBLISHED = 'None; used as published.';

export const CREDIT_GROUPS: CreditGroup[] = [
  {
    id: 'ideas',
    title: 'Ideas and the people who had them',
    credits: [
      {
        name: 'Beads',
        url: 'https://github.com/steveyegge/beads',
        use: "Steve Yegge's issue tracker for AI agents: its beads are the stories, epics and decisions Postern's map, cards and bead pages show.",
        ...MIT,
        licenceUrl: 'https://github.com/steveyegge/beads/blob/main/LICENSE',
        changes: 'None to Beads itself; Postern only reads and shows the factory\'s beads.',
      },
      {
        name: 'Gas Town',
        url: 'https://github.com/steveyegge/gastown',
        use: "Steve Yegge's multi-agent workspace manager: the idea of a Mayor who coordinates and workers who each take one piece of work is the shape of the factory Postern is the phone for.",
        ...MIT,
        licenceUrl: 'https://github.com/steveyegge/gastown/blob/main/LICENSE',
        changes: 'We took the ideas, not the code, and bent them to our own factory (millwright).',
      },
      {
        name: 'Claude Code',
        url: 'https://claude.com/product/claude-code',
        use: "Anthropic's coding agent: it wrote and tested this app, and it is the Mayor and the Builders the Governor talks to through it.",
        licence: 'Anthropic Commercial Terms',
        licenceUrl: 'https://www.anthropic.com/legal/commercial-terms',
        changes: 'None; it is a tool we work with, not code we ship.',
      },
      {
        name: 'SpellForge',
        url: 'https://github.com/Jonathan-A-White/spell-forge',
        use: "The Governor's earlier app, whose stack (React, TypeScript, Vite, Tailwind, Dexie, vitest) and licence-gate pattern Postern follows.",
        ...MIT,
        licenceUrl: 'https://github.com/Jonathan-A-White/spell-forge/blob/main/LICENSE',
        changes: 'Its patterns were reworked for Postern; its chain package is credited below.',
      },
      {
        name: 'BIP-39',
        url: 'https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki',
        use: "The Bitcoin Improvement Proposal by Marek Palatinus, Pavol Rusnak, Aaron Voisine and Sean Bowe that defines the twelve-word recovery phrase your key is made from.",
        ...MIT,
        changes: 'None; implemented by scure-bip39, below.',
      },
    ],
  },
  {
    id: 'services',
    title: 'Outside services and standards',
    credits: [
      {
        name: 'WhatsOnChain',
        url: 'https://whatsonchain.com',
        use: 'The public API Postern uses to read the BSV chain and to send to it: the licence check, the balance and the transactions that carry the messages.',
        licence: 'WhatsOnChain terms of use',
        licenceUrl: 'https://whatsonchain.com/terms',
        changes: 'None; we call its public API as published, and pace the calls so as not to burden it.',
      },
      {
        name: 'BSV blockchain',
        url: 'https://bitcoinsv.io',
        use: 'The chain that gives Postern its identity and licence and carries its end-to-end encrypted messages.',
        licence: 'Open BSV License',
        licenceUrl: 'https://github.com/bsv-blockchain/ts-stack/blob/main/packages/sdk/LICENSE.txt',
        changes: 'None; we use the testnet until the Governor says mainnet.',
      },
      {
        name: 'Web Push and VAPID',
        url: 'https://www.rfc-editor.org/rfc/rfc8292',
        use: 'The IETF standards (RFC 8030, RFC 8292) behind the notifications that reach your phone through the browser maker\'s push service.',
        licence: 'IETF Trust Legal Provisions',
        licenceUrl: 'https://trustee.ietf.org/license-info/IETF-TLP-5.htm',
        changes: 'None; implemented by webpush-go, below.',
      },
      {
        name: 'Web Speech API',
        url: 'https://webaudio.github.io/web-speech-api/',
        use: "The W3C draft behind the voice features: the phone's own speech recogniser hears you on the Talk line and the hold-to-talk button, and its speech synthesiser reads messages aloud. The engine is the browser's, which may be a cloud service run by the browser's maker; Postern bundles no speech model.",
        licence: 'W3C Software and Document License',
        licenceUrl: 'https://www.w3.org/copyright/software-license/',
        changes: 'None; we only call it.',
      },
      {
        name: 'MediaRecorder API',
        url: 'https://w3c.github.io/mediacapture-record/',
        use: 'The W3C standard that records the voice notes you send, in the Opus format where the browser has it.',
        licence: 'W3C Software and Document License',
        licenceUrl: 'https://www.w3.org/copyright/software-license/',
        changes: 'None; we only call it.',
      },
      {
        name: 'Opus',
        url: 'https://opus-codec.org',
        use: 'The audio codec (RFC 6716, from Xiph.Org, Skype and the IETF) the voice notes are recorded in.',
        licence: 'BSD-3-Clause',
        licenceUrl: 'https://opus-codec.org/license/',
        changes: 'None; the browser carries the codec, not us.',
      },
      {
        name: 'Web Authentication',
        url: 'https://www.w3.org/TR/webauthn-3/',
        use: 'The W3C standard behind the passkey that can unlock your key on this phone.',
        licence: 'W3C Software and Document License',
        licenceUrl: 'https://www.w3.org/copyright/software-license/',
        changes: 'None; we only call it.',
      },
    ],
  },
  {
    id: 'app',
    title: 'Libraries that run in the app',
    credits: [
      { name: 'React', url: 'https://react.dev', use: 'The interface: every screen you see.', ...MIT, changes: AS_PUBLISHED, covers: ['react', 'react-dom'] },
      {
        name: 'BSV SDK',
        url: 'https://github.com/bsv-blockchain/ts-stack/tree/main/packages/sdk',
        use: 'Keys, signatures and transactions on the BSV chain.',
        licence: 'Open BSV License version 4',
        licenceUrl: 'https://github.com/bsv-blockchain/ts-stack/blob/main/packages/sdk/LICENSE.txt',
        changes: AS_PUBLISHED,
        covers: ['@bsv/sdk'],
      },
      {
        name: 'spell-forge-bsv',
        url: 'https://github.com/Jonathan-A-White/spell-forge',
        use: "The chain package from SpellForge: the licence check and the chain provider behind Postern's gate.",
        ...MIT,
        licenceUrl: 'https://github.com/Jonathan-A-White/spell-forge/blob/main/LICENSE',
        changes: AS_PUBLISHED,
        covers: ['spell-forge-bsv'],
      },
      {
        name: 'scure-bip39',
        url: 'https://paulmillr.com/noble/#scure',
        use: "Paul Miller's audited BIP-39 library: makes and checks the recovery phrase.",
        ...MIT,
        changes: AS_PUBLISHED,
        covers: ['@scure/bip39'],
      },
      { name: 'Dexie', url: 'https://dexie.org', use: "The database in your phone's browser where messages, the view and the outbox are kept.", ...APACHE, changes: AS_PUBLISHED, covers: ['dexie'] },
      { name: 'Mermaid', url: 'https://github.com/mermaid-js/mermaid', use: 'Draws the diagrams that appear in messages.', ...MIT, changes: AS_PUBLISHED, covers: ['mermaid'] },
      { name: 'node-qrcode', url: 'https://github.com/soldair/node-qrcode', use: 'Draws the QR code for your public key.', ...MIT, changes: AS_PUBLISHED, covers: ['qrcode'] },
      { name: 'react-markdown', url: 'https://github.com/remarkjs/react-markdown', use: 'Shows the Markdown in messages and bead pages as formatted text.', ...MIT, changes: AS_PUBLISHED, covers: ['react-markdown'] },
      { name: 'remark-gfm', url: 'https://github.com/remarkjs/remark-gfm', use: 'Adds tables, task lists and strikethrough to that Markdown.', ...MIT, changes: AS_PUBLISHED, covers: ['remark-gfm'] },
      {
        name: 'Workbox',
        url: 'https://github.com/GoogleChrome/workbox',
        use: "Keeps the app's files on your phone so it opens offline.",
        ...MIT,
        changes: AS_PUBLISHED,
        covers: ['workbox-precaching'],
      },
    ],
  },
  {
    id: 'backend',
    title: 'The backend, written in Go',
    credits: [
      { name: 'Go', url: 'https://go.dev', use: 'The language and standard library the backend beside the factory is written in.', ...BSD3, licenceUrl: 'https://go.dev/LICENSE', changes: AS_PUBLISHED },
      {
        name: 'webpush-go',
        url: 'https://github.com/SherClockHolmes/webpush-go',
        use: 'Sends the push notifications.',
        ...MIT,
        changes: AS_PUBLISHED,
        covers: ['github.com/SherClockHolmes/webpush-go'],
      },
      {
        name: 'btcec',
        url: 'https://github.com/btcsuite/btcd/tree/master/btcec',
        use: "btcsuite's secp256k1 library: checks the signatures on every request.",
        ...ISC,
        changes: AS_PUBLISHED,
        covers: ['github.com/btcsuite/btcd/btcec/v2'],
      },
      {
        name: 'dcrd secp256k1',
        url: 'https://github.com/decred/dcrd/tree/master/dcrec/secp256k1',
        use: "The Decred developers' secp256k1 code that btcec is built on.",
        ...ISC,
        changes: AS_PUBLISHED,
        covers: ['github.com/decred/dcrd/dcrec/secp256k1/v4'],
      },
      {
        name: 'golang-jwt',
        url: 'https://github.com/golang-jwt/jwt',
        use: 'Signed tokens, brought in by webpush-go for its VAPID headers.',
        ...MIT,
        licenceUrl: 'https://github.com/golang-jwt/jwt/blob/main/LICENSE',
        changes: AS_PUBLISHED,
        covers: ['github.com/golang-jwt/jwt/v5'],
      },
      {
        name: 'Go x/crypto',
        url: 'https://pkg.go.dev/golang.org/x/crypto',
        use: "The Go team's supplementary cryptography: encryption and key derivation.",
        ...BSD3,
        licenceUrl: 'https://go.googlesource.com/crypto/+/refs/heads/master/LICENSE',
        changes: AS_PUBLISHED,
        covers: ['golang.org/x/crypto'],
      },
      { name: 'nginx', url: 'https://nginx.org', use: 'Serves the app at postern.allmymind.org and passes the API through to the backend.', licence: 'BSD-2-Clause', licenceUrl: 'https://nginx.org/LICENSE', changes: 'None; only configured.' },
    ],
  },
  {
    id: 'tools',
    title: 'Tools that build and test it',
    credits: [
      { name: 'Vite', url: 'https://vite.dev', use: 'Builds the app from its source.', ...MIT, changes: AS_PUBLISHED, covers: ['vite', '@vitejs/plugin-react'] },
      { name: 'Tailwind CSS', url: 'https://tailwindcss.com', use: "Styles every screen from the design tokens.", ...MIT, changes: AS_PUBLISHED, covers: ['tailwindcss', '@tailwindcss/vite'] },
      { name: 'vite-plugin-pwa', url: 'https://github.com/vite-pwa/vite-plugin-pwa', use: 'Turns the build into an installable app with its service worker.', ...MIT, changes: AS_PUBLISHED, covers: ['vite-plugin-pwa'] },
      { name: 'TypeScript', url: 'https://www.typescriptlang.org', use: 'The language the app is written in, and its type checker.', ...APACHE, changes: AS_PUBLISHED, covers: ['typescript'] },
      {
        name: 'DefinitelyTyped',
        url: 'https://github.com/DefinitelyTyped/DefinitelyTyped',
        use: 'The type definitions for React, Node and qrcode.',
        ...MIT,
        changes: AS_PUBLISHED,
        covers: ['@types/node', '@types/qrcode', '@types/react', '@types/react-dom'],
      },
      { name: 'tsx', url: 'https://tsx.hirok.io', use: 'Runs the TypeScript scripts, such as the fixture generator.', ...MIT, changes: AS_PUBLISHED, covers: ['tsx'] },
      { name: 'ESLint', url: 'https://eslint.org', use: 'Catches mistakes and keeps the code to its rules.', ...MIT, changes: AS_PUBLISHED, covers: ['eslint', '@eslint/js', 'globals'] },
      { name: 'typescript-eslint', url: 'https://typescript-eslint.io', use: 'Lets ESLint read TypeScript.', ...MIT, changes: AS_PUBLISHED, covers: ['typescript-eslint'] },
      { name: 'eslint-plugin-react-hooks', url: 'https://react.dev', use: "The React team's lint rules for hooks.", ...MIT, changes: AS_PUBLISHED, covers: ['eslint-plugin-react-hooks'] },
      { name: 'eslint-plugin-react-refresh', url: 'https://github.com/ArnaudBarre/eslint-plugin-react-refresh', use: 'Lint rules that keep hot reloading working.', ...MIT, changes: AS_PUBLISHED, covers: ['eslint-plugin-react-refresh'] },
      { name: 'Vitest', url: 'https://vitest.dev', use: 'Runs the unit tests and the feature scenarios.', ...MIT, changes: AS_PUBLISHED, covers: ['vitest'] },
      {
        name: 'vitest-cucumber',
        url: 'https://github.com/amiceli/vitest-cucumber',
        use: 'Runs the Gherkin scenarios under features/ as Vitest tests.',
        ...ISC,
        changes: AS_PUBLISHED,
        covers: ['@amiceli/vitest-cucumber'],
      },
      {
        name: 'Testing Library',
        url: 'https://testing-library.com',
        use: 'Tests the screens the way a person uses them (React Testing Library, user-event and jest-dom).',
        ...MIT,
        changes: AS_PUBLISHED,
        covers: ['@testing-library/react', '@testing-library/user-event', '@testing-library/jest-dom'],
      },
      { name: 'jsdom', url: 'https://github.com/jsdom/jsdom', use: 'A browser stand-in for the unit tests.', ...MIT, changes: AS_PUBLISHED, covers: ['jsdom'] },
      { name: 'fake-indexeddb', url: 'https://github.com/dumbmatter/fakeIndexedDB', use: "A stand-in for the browser's database in the tests.", ...APACHE, changes: AS_PUBLISHED, covers: ['fake-indexeddb'] },
      { name: 'Playwright', url: 'https://playwright.dev', use: 'Drives a real browser through the app for the end-to-end tests and the screenshots.', ...APACHE, changes: AS_PUBLISHED, covers: ['@playwright/test'] },
    ],
  },
];

export function allCredits(): Credit[] {
  return CREDIT_GROUPS.flatMap((group) => group.credits);
}

/** The modules a go.mod requires, direct and indirect, in the order it lists them. */
export function goModules(goMod: string): string[] {
  const modules: string[] = [];
  let inBlock = false;
  for (const raw of goMod.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (line === 'require (') inBlock = true;
    else if (inBlock && line === ')') inBlock = false;
    else if (inBlock && line) modules.push(line.split(/\s+/)[0]);
    else if (line.startsWith('require ') && !line.endsWith('(')) modules.push(line.split(/\s+/)[1]);
  }
  return modules;
}

/** The dependencies (npm packages or Go modules) that no credit covers. */
export function uncredited(dependencies: string[]): string[] {
  const covered = new Set(allCredits().flatMap((credit) => credit.covers ?? []));
  return dependencies.filter((dependency) => !covered.has(dependency));
}
