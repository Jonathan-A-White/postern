// tests/unit/todo-edits.test.ts — mw-ev7oyy.7: what the To do board shows at once for a card added,
// edited or moved (applyChanges), how it names the place a dropped card goes (moveFor), where a drag
// lands (dropPlace), and when a change the phone has sent is waiting, settled, or refused (judge).
import { describe, expect, it } from 'vitest';
import type { OutboxRow } from '../../src/data/db';
import { OTHER_LIST, REFUSED_AFTER_MS, applyChanges, dropPlace, judge, moveFor, type TodoChange, type TodoList } from '../../src/todo';

const card = (id: string) => ({ id, title: `Title of ${id}`, priority: 2, created: '2026-10-13T10:00:00Z' });
const lists = (): TodoList[] => [
  { id: 'mw-a', title: 'List A', name: 'List A', epic: 'mw-a', created: '2026-10-13T10:00:00Z', cards: [card('mw-a.1'), card('mw-a.2'), card('mw-a.3')] },
  { id: 'mw-b', title: 'List B', name: 'List B', epic: 'mw-b', created: '2026-10-12T10:00:00Z', cards: [card('mw-b.1')] },
  { id: OTHER_LIST, title: 'Other', name: 'Other', created: '', cards: [card('mw-x.1'), card('mw-x.2')] },
];
const ids = (list: TodoList) => list.cards.map((c) => c.id);
const at = (change: TodoChange['action'], id = 1): TodoChange => ({ id, action: change });

describe('applyChanges: the board before the Mayor has answered', () => {
  it('puts an added card at the foot of its list, marked as adding', () => {
    const { lists: out } = applyChanges(lists(), [at({ action: 'todo_add', list: 'mw-a', title: 'Buy bin bags' }, 7)]);
    expect(ids(out[0])).toEqual(['mw-a.1', 'mw-a.2', 'mw-a.3', 'pending:7']);
    expect(out[0].cards[3]).toMatchObject({ title: 'Buy bin bags', pending: true, adding: true });
  });

  it('shows an edited title and keeps the edited notes for the back', () => {
    const { lists: out, notes } = applyChanges(lists(), [at({ action: 'todo_edit', bead: 'mw-a.2', title: 'New words', notes: 'Fresh notes' })]);
    expect(out[0].cards[1]).toMatchObject({ id: 'mw-a.2', title: 'New words', pending: true });
    expect(out[0].cards[1].adding).toBeUndefined();
    expect(notes.get('mw-a.2')).toBe('Fresh notes');
  });

  it('shows an edited due time at once, and its removal', () => {
    const dated = lists();
    dated[0].cards[0] = { ...dated[0].cards[0], due: '2026-10-14T09:00:00Z' };
    const set = applyChanges(lists(), [at({ action: 'todo_edit', bead: 'mw-a.2', due: '2026-10-15T09:00:00.000Z' })]).lists;
    expect(set[0].cards[1]).toMatchObject({ due: '2026-10-15T09:00:00.000Z', pending: true });
    const cleared = applyChanges(dated, [at({ action: 'todo_edit', bead: 'mw-a.1', due: '' })]).lists;
    expect(cleared[0].cards[0].due).toBeUndefined();
    expect(cleared[0].cards[0].pending).toBe(true);
  });

  it('moves a card above another in its list', () => {
    const { lists: out } = applyChanges(lists(), [at({ action: 'todo_move', bead: 'mw-a.3', before: 'mw-a.1' })]);
    expect(ids(out[0])).toEqual(['mw-a.3', 'mw-a.1', 'mw-a.2']);
    expect(out[0].cards[0].pending).toBe(true);
  });

  it('moves a card below another, to the end of another list, or between two cards', () => {
    expect(ids(applyChanges(lists(), [at({ action: 'todo_move', bead: 'mw-a.1', after: 'mw-a.2' })]).lists[0])).toEqual(['mw-a.2', 'mw-a.1', 'mw-a.3']);
    const toB = applyChanges(lists(), [at({ action: 'todo_move', bead: 'mw-a.1', list: 'mw-b' })]).lists;
    expect(ids(toB[0])).toEqual(['mw-a.2', 'mw-a.3']);
    expect(ids(toB[1])).toEqual(['mw-b.1', 'mw-a.1']);
    const between = applyChanges(lists(), [at({ action: 'todo_move', bead: 'mw-a.1', list: 'mw-b', before: 'mw-b.1' })]).lists;
    expect(ids(between[1])).toEqual(['mw-a.1', 'mw-b.1']);
  });

  it('applies changes in order, and leaves the input alone', () => {
    const before = lists();
    const { lists: out } = applyChanges(before, [
      at({ action: 'todo_move', bead: 'mw-a.3', before: 'mw-a.1' }, 1),
      at({ action: 'todo_edit', bead: 'mw-a.3', title: 'Renamed' }, 2),
    ]);
    expect(out[0].cards[0]).toMatchObject({ id: 'mw-a.3', title: 'Renamed', pending: true });
    expect(before).toEqual(lists());
  });

  it('leaves out a change whose card or list is no longer on the board', () => {
    const { lists: out } = applyChanges(lists(), [
      at({ action: 'todo_add', list: 'mw-gone', title: 'Nowhere' }, 1),
      at({ action: 'todo_edit', bead: 'mw-gone.1', title: 'No such card' }, 2),
      at({ action: 'todo_move', bead: 'mw-a.1', list: 'mw-gone' }, 3),
    ]);
    expect(out).toEqual(lists());
  });
});

describe('moveFor: naming the place a dropped card goes', () => {
  it('names the card it lands before', () => {
    expect(moveFor(lists(), 'mw-a.3', 'mw-a', 0)).toEqual({ before: 'mw-a.1' });
    expect(moveFor(lists(), 'mw-a.1', 'mw-a', 1)).toEqual({ before: 'mw-a.3' });
  });

  it('names the card it lands after when it goes to the foot', () => {
    expect(moveFor(lists(), 'mw-a.1', 'mw-a', 2)).toEqual({ after: 'mw-a.3' });
  });

  it('is nothing when the card lands where it was', () => {
    expect(moveFor(lists(), 'mw-a.2', 'mw-a', 1)).toBeUndefined();
  });

  it('names the list for another list, and the neighbour when there is one', () => {
    expect(moveFor(lists(), 'mw-a.1', 'mw-b', 0)).toEqual({ list: 'mw-b', before: 'mw-b.1' });
    expect(moveFor(lists(), 'mw-a.1', 'mw-b', 1)).toEqual({ list: 'mw-b', after: 'mw-b.1' });
  });

  it('never lands a card on the Other list, which is no epic', () => {
    expect(moveFor(lists(), 'mw-a.1', OTHER_LIST, 0)).toBeUndefined();
    expect(moveFor(lists(), 'mw-x.1', OTHER_LIST, 1)).toEqual({ after: 'mw-x.2' });
  });

  it('skips a card still being added, which has no id the Mayor knows', () => {
    const out = applyChanges(lists(), [at({ action: 'todo_add', list: 'mw-b', title: 'New' }, 4)]).lists;
    expect(moveFor(out, 'mw-a.1', 'mw-b', 2)).toEqual({ list: 'mw-b', after: 'mw-b.1' });
    expect(moveFor(out, 'pending:4', 'mw-a', 0)).toBeUndefined();
  });
});

describe('dropPlace: where a drag lands', () => {
  const rect = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height });
  const columns = [
    { id: 'mw-a', rect: rect(0, 0, 300, 400), cards: [{ id: 'mw-a.1', rect: rect(0, 0, 300, 100) }, { id: 'mw-a.2', rect: rect(0, 110, 300, 100) }, { id: 'mw-a.3', rect: rect(0, 220, 300, 100) }] },
    { id: 'mw-b', rect: rect(310, 0, 300, 400), cards: [{ id: 'mw-b.1', rect: rect(310, 0, 300, 100) }] },
  ];

  it('is the list under the pointer and the index among the cards before the pointer', () => {
    expect(dropPlace(columns, 'mw-a.3', 100, 20)).toEqual({ list: 'mw-a', index: 0 });
    expect(dropPlace(columns, 'mw-a.3', 100, 140)).toEqual({ list: 'mw-a', index: 1 });
    expect(dropPlace(columns, 'mw-a.1', 100, 390)).toEqual({ list: 'mw-a', index: 2 });
    expect(dropPlace(columns, 'mw-a.1', 400, 90)).toEqual({ list: 'mw-b', index: 1 });
  });

  it('does not count the dragged card among the cards it passes', () => {
    expect(dropPlace(columns, 'mw-a.1', 100, 200)).toEqual({ list: 'mw-a', index: 1 });
  });

  it('is nothing off every column', () => {
    expect(dropPlace(columns, 'mw-a.1', 700, 40)).toBeUndefined();
  });
});

describe('judge: waiting, settled, refused or failed', () => {
  const row = (extra: Partial<OutboxRow> = {}): OutboxRow => ({ id: 1, kind: 'action', bead: 'mw-a.1', payload: {}, created: 1_000, attempts: 0, state: 'pending', ...extra });
  const ctx = (extra: Partial<Parameters<typeof judge>[1]> = {}) => ({ now: 2_000, ...extra });

  it('waits while the row has not gone, and while it has gone and the Mayor has had little time', () => {
    expect(judge(row(), ctx())).toBe('waiting');
    expect(judge(row({ state: 'sent', sentAt: 1_500 }), ctx({ now: 1_500 + REFUSED_AFTER_MS }))).toBe('waiting');
  });

  it('fails when the backend refused the row for good', () => {
    expect(judge(row({ state: 'failed', failure: 'No.' }), ctx())).toBe('failed');
  });

  it('is refused when the Mayor has had his time and echoed nothing', () => {
    expect(judge(row({ state: 'sent', sentAt: 1_500 }), ctx({ now: 1_501 + REFUSED_AFTER_MS }))).toBe('refused');
    expect(judge(row({ state: 'acked', sentAt: 1_500 }), ctx({ now: 1_501 + REFUSED_AFTER_MS }))).toBe('refused');
  });

  it('waits after the echo until the view has reached it, then is settled', () => {
    const sent = row({ state: 'acked', sentAt: 1_500 });
    expect(judge(sent, ctx({ echoSeq: 9, view: { seq: 8 } }))).toBe('waiting');
    expect(judge(sent, ctx({ echoSeq: 9, view: { seq: 9 } }))).toBe('settled');
    expect(judge(sent, ctx({ echoSeq: 9, view: { seq: 12 } }))).toBe('settled');
  });

  it('is never refused once the echo has come, however late', () => {
    expect(judge(row({ state: 'sent', sentAt: 1_500 }), ctx({ now: 99_999_999, echoSeq: 9, view: { seq: 3 } }))).toBe('waiting');
  });

  it('without a seq on the view, is settled once the view was written after the send', () => {
    const sent = row({ state: 'acked', sentAt: Date.parse('2026-10-13T10:00:00Z') });
    expect(judge(sent, ctx({ echoSeq: 9, view: { writtenAt: '2026-10-13T09:59:00Z' } }))).toBe('waiting');
    expect(judge(sent, ctx({ echoSeq: 9, view: { writtenAt: '2026-10-13T10:01:00Z' } }))).toBe('settled');
  });
});
