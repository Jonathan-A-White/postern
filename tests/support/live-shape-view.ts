// tests/support/live-shape-view.ts — mw-ev7oyy.43: a §11 view with the live view's shape at any size. The
// proportions are the live view's of 2026-10-17 23:19Z (`mw postern view --json`): 1252 beads, 1067 needs,
// 732 of them folded; of the rest 79% wait on him, 12% on the factory, 9% on the Mayor; his are verify 75%,
// stale 7.5%, demo 6.4%, question 5.7%, approve 4.2%, hands 1.1%. Verify texts run ~520 characters, approve
// texts 2–4 thousand, and one demo 10 thousand; every bead carries a 280-character summary. Deterministic.
import type { Need, NeedKind, View, ViewBead, WaitsFor } from '../../src/model/view';

/** The live view's size on 2026-10-17, the day Needs you froze on his phone. */
export const LIVE_SIZE = { needs: 1067, beads: 1252, folded: 732 } as const;

export interface ViewSize {
  needs: number;
  beads: number;
  /** How many of the needs are folded verify cards (§11 `folded`). */
  folded: number;
}

function iso(now: number, minutesAgo: number): string {
  return new Date(now - minutesAgo * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function words(seed: number, length: number): string {
  const vocabulary = ['the', 'landing', 'Postern', 'phone', 'shows', 'card', 'Mayor', 'checks', 'story', 'tap', 'screen', 'opens', 'at', 'once', 'and', 'says', 'what', 'happened'];
  let text = '';
  for (let i = 0; text.length < length; i++) text += `${vocabulary[(seed * 7 + i * 3) % vocabulary.length]} `;
  return text.slice(0, length).trim();
}

// Out of every 40 of his open cards, as the live view's 264 are spread.
const HIS_KINDS: NeedKind[] = [
  ...Array<NeedKind>(30).fill('verify'),
  'stale', 'stale', 'stale',
  'demo', 'demo', 'demo',
  'question', 'question',
  'approve',
  'hands',
];

// Out of every 100 open cards, whose turn.
function openWaiter(i: number): WaitsFor {
  const at = i % 100;
  return at < 79 ? 'you' : at < 91 ? 'factory' : 'mayor';
}

export function liveShapeView(now: number, size: ViewSize): View {
  const epics = Math.max(1, Math.round(size.beads / 12));
  const beads: ViewBead[] = [];
  for (let i = 0; i < size.beads; i++) {
    const epic = i < epics;
    const id = epic ? `mw-e${i}` : `mw-e${i % epics}.${i}`;
    beads.push({
      id,
      title: epic ? `Epic ${i}: ${words(i, 120)}` : `Story ${i}: ${words(i, 90)}`,
      type: epic ? 'epic' : 'task',
      status: epic ? 'open' : i % 5 === 0 ? 'closed' : 'open',
      priority: i % 4,
      ...(epic ? {} : { parent: `mw-e${i % epics}` }),
      labels: i % 9 === 0 ? ['demo'] : [],
      assignee: '',
      waits: !epic && i % 13 === 0 ? [`mw-e${(i + 1) % epics}.${i + 1}`] : [],
      created: iso(now, 60 * 24 * 20 - i),
      updated: iso(now, i),
      started: '',
      closed: !epic && i % 5 === 0 ? iso(now, i * 3) : '',
      path: { rig: 'postern', branch: 'main', host: 'laptop', model: 'sonnet', effort: 'high', formula: 'tdd-feature', harness: 'claude' },
      attempts: 0,
      summary: words(i, 280),
      comments: i % 61,
      done_earlier: epic ? i % 40 : 0,
    });
  }
  const stories = beads.filter((bead) => bead.type !== 'epic');
  const storyAt = (i: number) => stories[i % Math.max(1, stories.length)] ?? beads[0];

  const needs: Need[] = [];
  const open = size.needs - size.folded;
  let his = 0;
  for (let i = 0; i < size.needs; i++) {
    const bead = storyAt(i);
    const folded = i >= open;
    const waiter: WaitsFor = folded ? (i % 2 === 0 ? 'mayor' : 'you') : openWaiter(i);
    const kind: NeedKind = folded ? 'verify' : waiter === 'you' ? HIS_KINDS[his++ % HIS_KINDS.length] : waiter === 'mayor' ? 'verify' : 'demo';
    const since = iso(now, 30 + i * 17);
    const base = { bead: bead.id, epic: bead.parent ?? bead.id, title: bead.title, since, recommended: '', options: [] as string[], blocks: i % 7 === 0 ? 2 : 0, steps: [], waits_for: waiter };
    const need: Need =
      kind === 'question'
        ? { ...base, kind, text: `${words(i, 70)}?\n\n${words(i + 1, 900)}`, options: ['A: Keep it as it is', 'B: Change it'], recommended: 'A: Keep it as it is' }
        : kind === 'approve'
          ? { ...base, kind, bead: bead.parent ?? bead.id, text: `12 held stories wait for your Release: ${words(i, 2000 + (i % 3) * 1000)}` }
          : kind === 'demo'
            ? { ...base, kind, text: i === 1 ? words(i, 10_484) : words(i, 600), ...(waiter === 'factory' ? { not_ready: true, waiting_on: [storyAt(i + 1).title] } : {}) }
            : kind === 'hands'
              ? { ...base, kind, text: words(i, 300), steps: [{ id: 's1', host: 'laptop', as: 'user', run: 'mw doctor --fix', way_back: 'nothing to undo', sha256: 'ab'.repeat(32) }] }
              : kind === 'stale'
                ? { ...base, kind, text: words(i, 400) }
                : { ...base, kind, text: `Landed: ${words(i, 500)}`, ...(waiter === 'mayor' ? { not_ready: true, waiting_on: ['the Mayor to check the landing'] } : {}), ...(folded ? { folded: true } : {}) };
    needs.push(need);
  }
  return { v: 2, written_at: iso(now, 0), seq: 1, host: 'laptop', hosts: [{ name: 'laptop', last_sync: iso(now, 1) }], needs, beads };
}
