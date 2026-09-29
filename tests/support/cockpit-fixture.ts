// tests/support/cockpit-fixture.ts — one believable factory for the cockpit's
// tests and screenshots: a Postern map with epics at every stage, the BSV
// library map with a question, millwright work landed and to verify, a step for
// the Governor's hands and a stale host, plus a conversation that exercises every
// kind of message (a question, a threaded note, a voice note and its transcript,
// an answer and an action he sent).
import { createHash } from 'node:crypto';
import { PrivateKey, Utils } from '@bsv/sdk';
import { canonicalStep, type HandsStep } from '../../src/model/hands';
import { encryptMessage, type MessagePayload } from '../../src/services/messages';
import { encodeQuestion, encodeReply } from '../../src/services/questions';
import { encodeThreadedMessage } from '../../src/services/threads';
import type { BeadDetail, Need, View, ViewBead } from '../../src/model/view';

export const MAYOR = PrivateKey.fromHex('77'.repeat(32));

function iso(now: number, minutesAgo: number): string {
  return new Date(now - minutesAgo * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

type BeadInput = Partial<ViewBead> & Pick<ViewBead, 'id' | 'title'>;

function bead(input: BeadInput): ViewBead {
  return {
    type: 'task',
    status: 'open',
    priority: 2,
    labels: [],
    assignee: '',
    waits: [],
    created: '',
    updated: '',
    started: '',
    closed: '',
    attempts: 0,
    summary: '',
    comments: 0,
    done_earlier: 0,
    ...input,
  };
}

const path = (rig: string, host = 'desktop', model = 'sonnet', formula = 'tdd-feature') => ({
  rig,
  branch: 'main',
  host,
  model,
  effort: 'high',
  formula,
  harness: 'claude',
});

/** A hands step as the Mayor's host would put it in the view: hashed per §17. */
export function handsStep(bead: string, step: Omit<HandsStep, 'sha256'>): HandsStep {
  return { ...step, sha256: createHash('sha256').update(canonicalStep(bead, step), 'utf8').digest('hex') };
}

export function fixtureView(now: number = Date.now()): View {
  const t = (m: number) => iso(now, m);
  const beads: ViewBead[] = [
    bead({ id: 'mw-f758y', title: "Postern: the Governor's cockpit", type: 'epic', status: 'in_progress', priority: 1, labels: ['wayfinder:map'], updated: t(3), done_earlier: 41 }),
    bead({ id: 'mw-f758y.30', title: 'Live view and the direct channel', type: 'epic', status: 'in_progress', priority: 1, parent: 'mw-f758y', updated: t(3), path: path('postern') }),
    bead({ id: 'mw-f758y.30.1', title: 'POST /api/messages takes a record script directly', parent: 'mw-f758y.30', status: 'closed', closed: t(95), updated: t(95), path: path('postern'), summary: 'Direct delivery, protocol §9.', comments: 4 }),
    bead({ id: 'mw-f758y.30.2', title: 'GET /api/events streams message and view changes', parent: 'mw-f758y.30', status: 'in_progress', started: t(22), updated: t(3), assignee: 'mw@desktop', path: path('postern'), attempts: 1, summary: 'Server-sent events: hello, message, view, ping every 25 s.', comments: 5, waits: ['mw-f758y.30.1'] }),
    bead({ id: 'mw-f758y.30.3', title: 'mw postern view writes the live view', parent: 'mw-f758y.30', status: 'in_progress', started: t(40), updated: t(6), assignee: 'mw@desktop', path: path('millwright'), attempts: 2, summary: 'The whole live tree, gzip then BRC-78 to his key.', comments: 3 }),
    bead({ id: 'mw-f758y.30.4', title: 'GET /api/beads/{id} runs mw postern bead', parent: 'mw-f758y.30', waits: ['mw-f758y.30.1'], path: path('postern'), updated: t(120) }),
    bead({ id: 'mw-f758y.30.5', title: 'The cockpit reads the live view and the stream', parent: 'mw-f758y.30', priority: 1, waits: ['mw-f758y.30.2', 'mw-f758y.30.3'], path: path('postern', 'desktop', 'opus'), updated: t(120) }),
    bead({ id: 'mw-f758y.31', title: 'Cockpit screens', type: 'epic', status: 'open', priority: 1, parent: 'mw-f758y', updated: t(30), path: path('postern') }),
    bead({ id: 'mw-f758y.31.1', title: 'Needs-you queue with one-tap answers', parent: 'mw-f758y.31', path: path('postern'), updated: t(30) }),
    bead({ id: 'mw-f758y.31.2', title: 'Map zoom: board, graph and list', parent: 'mw-f758y.31', status: 'deferred', path: path('postern'), updated: t(30), waits: ['mw-f758y.31.1'] }),
    bead({ id: 'mw-f758y.31.3', title: 'Voice notes transcribed on the desktop', parent: 'mw-f758y.31', status: 'deferred', path: path('postern'), updated: t(30) }),
    bead({ id: 'mw-f758y.31.4', title: 'Share sheet and paste', parent: 'mw-f758y.31', status: 'deferred', path: path('postern'), updated: t(30) }),
    bead({ id: 'mw-f758y.8', title: 'Run the sudo lines for the desktop move', parent: 'mw-f758y', labels: ['hitl'], priority: 0, updated: t(50), summary: 'loginctl enable-linger, apt install ffmpeg mosh, nginx reload.', comments: 2 }),
    bead({ id: 'mw-2rbm', title: 'The BSV library, built to its spec', type: 'epic', status: 'open', priority: 2, labels: ['wayfinder:map'], updated: t(240), done_earlier: 9 }),
    bead({ id: 'mw-2rbm.10', title: 'Where should the BSV library live?', parent: 'mw-2rbm', type: 'task', priority: 1, updated: t(18), summary: 'A grilling ticket: the repo the core moves to.', comments: 2 }),
    bead({ id: 'mw-2rbm.11', title: 'Epoch-key encryption from argus keyGrant', parent: 'mw-2rbm', waits: ['mw-2rbm.10'], path: path('spell-forge'), updated: t(240) }),
    bead({ id: 'mw-2rbm.12', title: 'ARC broadcast with pending, accepted, proven, failed', parent: 'mw-2rbm', waits: ['mw-2rbm.10'], path: path('spell-forge'), updated: t(240) }),
    bead({ id: 'mw-2rbm.13', title: 'Shared test vectors run by TS and Go', parent: 'mw-2rbm', waits: ['mw-2rbm.11', 'mw-2rbm.12'], path: path('spell-forge'), updated: t(240) }),
    bead({ id: 'mw-2rbm.9', title: 'Fuel contract spend with FEE_CAP', parent: 'mw-2rbm', status: 'closed', closed: t(60 * 50), updated: t(60 * 50), path: path('spell-forge') }),
    bead({ id: 'mw-gq6', title: 'Millwright: a factory that ships a change to itself', type: 'epic', status: 'in_progress', priority: 1, updated: t(8), done_earlier: 128 }),
    bead({ id: 'mw-gq6.130', title: 'Beads sync modes: remote, backup, shared', parent: 'mw-gq6', status: 'closed', closed: t(130), updated: t(130), path: path('millwright'), comments: 3 }),
    bead({ id: 'mw-gq6.131', title: "mail-notify's view step every 30 s", parent: 'mw-gq6', status: 'in_progress', started: t(12), updated: t(8), assignee: 'mw@laptop', path: path('millwright', 'laptop'), attempts: 1 }),
    bead({ id: 'mw-gq6.132', title: 'Laptop boost: bd on the desktop Dolt server', parent: 'mw-gq6', path: path('millwright', 'laptop'), updated: t(200) }),
    bead({ id: 'mw-gq6.133', title: 'Doctor: beads server reachable', parent: 'mw-gq6', path: path('millwright'), attempts: 3, updated: t(80) }),
    bead({ id: 'mw-jb2p5', title: 'A.R.G.U.S. shared supply ledger', type: 'epic', status: 'open', priority: 2, updated: t(600), done_earlier: 14 }),
    bead({ id: 'mw-jb2p5.3', title: 'Stage 3: supply counts on main', parent: 'mw-jb2p5', status: 'deferred', path: path('argus'), updated: t(600) }),
  ];

  const needs: Need[] = [
    {
      kind: 'question',
      bead: 'mw-2rbm.10',
      epic: 'mw-2rbm',
      title: 'Where should the BSV library live?',
      since: t(18),
      text: 'The core leaves spell-forge so postern, spell-forge and argus consume one released package.\n\n- **New repo `bsv-kit`** — its own releases and CI; the Go port sits beside it.\n- **Workspace in spell-forge** — no new repo, but every release rides spell-forge\'s CI.',
      recommended: 'New repo bsv-kit',
      options: ['New repo bsv-kit', 'Workspace in spell-forge'],
      blocks: 3,
      steps: [],
    },
    { kind: 'approve', bead: 'mw-f758y.31', epic: 'mw-f758y', title: 'Cockpit screens', since: t(30), text: '3 stories held for your word.', recommended: 'Release', options: ['Release'], blocks: 3, steps: [] },
    {
      kind: 'hands',
      bead: 'mw-f758y.8',
      epic: 'mw-f758y',
      title: 'Run the sudo lines for the desktop move',
      since: t(50),
      text: 'Three steps the Mayor cannot take: user units without a login, the voice and mosh packages, and nginx pointed at the desktop.',
      recommended: '',
      options: [],
      blocks: 1,
      steps: [
        handsStep('mw-f758y.8', { id: 'linger', host: 'desktop', as: 'root', run: 'loginctl enable-linger jwhite', way_back: 'loginctl disable-linger jwhite' }),
        handsStep('mw-f758y.8', { id: 'packages', host: 'desktop', as: 'root', run: 'apt-get install -y ffmpeg mosh', way_back: 'apt-get remove -y ffmpeg mosh' }),
        handsStep('mw-f758y.8', {
          id: 'nginx',
          host: 'vps',
          as: 'root',
          run: 'nginx -t && systemctl reload nginx',
          way_back: 'cp /etc/nginx/sites-available/postern.prev /etc/nginx/sites-available/postern && systemctl reload nginx',
          ran: { at: t(20), exit: 0, host: 'vps' },
        }),
      ],
    },
    { kind: 'verify', bead: 'mw-gq6.130', epic: 'mw-gq6', title: 'Beads sync modes: remote, backup, shared', since: t(130), text: '', recommended: '', options: ['Verified'], blocks: 0, steps: [] },
    { kind: 'alarm', bead: 'mw-gq6.133', epic: 'mw-gq6', title: 'Doctor: beads server reachable used all 3 attempts', since: t(80), text: 'Refused three times on the same feature test; the Mayor has not looked yet.', recommended: '', options: [], blocks: 0, steps: [] },
  ];

  return {
    v: 2,
    written_at: t(0.5),
    host: 'desktop',
    hosts: [
      { name: 'desktop', last_sync: t(1) },
      { name: 'laptop', last_sync: t(34) },
    ],
    needs,
    beads,
  };
}

/** docs/protocol.md §11: a bead gone stale, its facts in the need's text (over 280 characters, so a clipped card would lose the end). */
export const STALE_FACTS_END = 'Newest comment: "Parked until the Dolt server moves; nobody has touched it since."';

export function fixtureStaleNeed(now: number = Date.now()): Need {
  return {
    kind: 'stale',
    bead: 'mw-gq6.132',
    epic: 'mw-gq6',
    title: 'Laptop boost: bd on the desktop Dolt server',
    since: iso(now, 20),
    text: `An open task, 41 days old. It waits on mw-gq6.131, which is still in progress, and nothing else waits on it. Nobody has claimed it and no Builder has tried it. It was last updated 41 days ago, before the desktop move. ${STALE_FACTS_END}`,
    recommended: '',
    options: ['Keep', 'Close'],
    blocks: 0,
    steps: [],
  };
}

export function fixtureDetail(id: string, now: number = Date.now()): BeadDetail | undefined {
  const view = fixtureView(now);
  const b = view.beads.find((candidate) => candidate.id === id);
  if (!b) return undefined;
  const t = (m: number) => iso(now, m);
  const rich = id === 'mw-f758y.30.2';
  return {
    v: 2,
    id: b.id,
    title: b.title,
    type: b.type,
    status: b.status,
    priority: b.priority,
    parent: b.parent,
    labels: b.labels,
    assignee: b.assignee,
    waits: b.waits,
    blocks: view.beads.filter((other) => other.waits.includes(id)).map((other) => other.id),
    children: view.beads.filter((other) => other.parent === id).map((other) => other.id),
    created: t(300),
    updated: b.updated,
    started: b.started,
    closed: b.closed,
    path: b.path,
    attempts: b.attempts,
    description: rich
      ? 'Stream what changes so the app never polls.\n\n```mermaid\nsequenceDiagram\n  App->>Backend: GET /api/events\n  Backend-->>App: hello {head, view}\n  Backend-->>App: message {seq}\n  Backend-->>App: view {etag}\n```\n\nThe app reads it with `fetch`, not `EventSource`, because it must send the Authorization header.'
      : b.summary || 'No description yet.',
    acceptance: rich ? '- `hello` arrives first with the index head and the view ETag\n- a direct message produces a `message` event within a second\n- a changed view file produces a `view` event\n- `: ping` every 25 s' : '',
    comments: rich
      ? [
          { at: t(12), author: 'root', text: `The Governor by postern ${new Date(Math.floor((now - 12 * 60_000) / 1000) * 1000).toISOString().replace('.000Z', 'Z')}: The tile looks off [image: /home/jwhite/.local/state/mw/postern/inbox/direct-3f22cda7ec41e68a062450299dfeb854879431a9f834c933bec20b09894f3d4f.jpg]` },
          { at: t(200), author: 'root', text: 'Filed from plan 0021: the Governor wants messages within a second.' },
          { at: t(22), author: 'mw@desktop', text: 'Claimed. Starting with a hub that never blocks the poller on a slow client.' },
          { at: t(9), author: 'mw@desktop', text: 'Hub and handler done, 14 tests. Working on the view watcher.' },
        ]
      : [{ at: t(60), author: 'root', text: 'Path set: sonnet, high effort, desktop.' }],
  };
}

export interface FixtureRecord {
  seq: number;
  txid: string;
  vout: number;
  payload: MessagePayload;
}

function hex64(seed: number): string {
  return Utils.toHex(Array.from({ length: 32 }, (_, i) => (seed * 31 + i * 7) % 256));
}

/** The conversation, as the backend's GET /api/messages would return it. */
export function fixtureRecords(governorKey: PrivateKey, now: number = Date.now(), voice?: { hash: string; size: number; mime: string }): FixtureRecord[] {
  const governorPub = governorKey.toPublicKey().toString();
  const mayorPub = MAYOR.toPublicKey().toString();
  const ts = (m: number) => Math.floor((now - m * 60_000) / 1000);
  let seq = 0;
  const fromMayor = (text: string, minutes: number, cls: MessagePayload['class'] = 'message'): FixtureRecord => ({
    seq: ++seq,
    txid: `direct:${hex64(seq)}`,
    vout: 0,
    payload: { ...encryptMessage({ text, class: cls, senderPrivateKeyHex: MAYOR.toHex(), recipientPublicKeyHex: governorPub }), ts: ts(minutes) },
  });
  const fromGovernor = (text: string, minutes: number): FixtureRecord => ({
    seq: ++seq,
    txid: `direct:${hex64(seq)}`,
    vout: 0,
    payload: { ...encryptMessage({ text, class: 'message', senderPrivateKeyHex: governorKey.toHex(), recipientPublicKeyHex: mayorPub }), ts: ts(minutes) },
  });

  const voiceNote = fromGovernor(encodeThreadedMessage({ thread: { bead: 'mw-f758y.30.2' }, text: '', attachment: voice ?? { hash: 'ab'.repeat(32), size: 48213, mime: 'audio/webm' } }), 15);
  return [
    fromMayor('Good morning. Overnight **4 stories landed** and one was sent back (a flaky test; attempt 2 is green). Three things need you — the library question first.', 25),
    fromGovernor('Thanks. Keep the laptop at cap 0 today, I am on the train.', 21),
    fromMayor(encodeQuestion({ bead: 'mw-2rbm.10', q: 'Where should the BSV library live?', rec: 'New repo bsv-kit', options: ['New repo bsv-kit', 'Workspace in spell-forge'] }), 18, 'decision-needed'),
    voiceNote,
    fromMayor(encodeThreadedMessage({ thread: { bead: 'mw-f758y.30.2' }, text: 'Make the ping interval 25 seconds so the train Wi-Fi proxy never idles the stream out.', re: voiceNote.txid, role: 'transcript' }), 14),
    fromGovernor(encodeThreadedMessage({ thread: { bead: 'mw-f758y.30.2' }, text: 'The tile looks off', attachment: { hash: 'cd'.repeat(32), size: 90211, mime: 'image/jpeg' } }), 12),
    fromMayor(encodeThreadedMessage({ thread: { bead: 'mw-f758y.30.2' }, text: 'Done — 25 s it is. The Builder has it on the bead; it lands in about ten minutes.' }), 13),
    fromGovernor(encodeReply({ bead: 'mw-gq6.120', answer: 'Yes' }), 300),
    fromMayor(encodeThreadedMessage({ thread: { topic: 'desktop move' }, text: 'The runbook is in `hosts/desktop-move.md`. Step 2 needs you: two sudo lines, on the bead.' }), 48),
  ];
}
