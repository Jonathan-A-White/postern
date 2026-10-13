// tests/unit/todo-store.test.tsx — mw-ev7oyy.7: the Postern TodoStore over a stored view and the outbox.
// add / edit / move show at once in `lists` marked pending and queue the §13 todo_* action; a row the
// backend refuses, or the Mayor never echoes, is rolled back with a notice; one the view has caught up with is settled.
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/data/db';
import { outboxRepo, viewRepo } from '../../src/data/repositories';
import { forgetOutboxState } from '../../src/services/outbox';
import { REFUSED_AFTER_MS, usePosternTodoStore } from '../../src/todo';
import { fixtureView } from '../support/cockpit-fixture';
import type { ViewBead } from '../../src/model/view';

const now = Date.now();
const bead = (id: string, extra: Partial<ViewBead>): ViewBead => ({ ...fixtureView(now).beads[0], id, title: `Title of ${id}`, type: 'task', status: 'open', parent: undefined, labels: [], waits: [], done_earlier: 0, closed: '', created: new Date(now - 3_600_000).toISOString(), ...extra });
const BEADS: ViewBead[] = [
  bead('mw-list', { type: 'epic', labels: ['hitl'] }),
  bead('mw-list.1', { parent: 'mw-list', labels: ['hitl', 'hitl:todo'], created: new Date(now - 7_200_000).toISOString() }),
  bead('mw-list.2', { parent: 'mw-list', labels: ['hitl', 'hitl:todo'] }),
  bead('mw-other', { type: 'epic', labels: ['hitl'], created: new Date(now - 86_400_000).toISOString() }),
  bead('mw-other.1', { parent: 'mw-other', labels: ['hitl', 'hitl:todo'] }),
];

async function saveView(seq?: number): Promise<void> {
  await viewRepo.save({ plaintext: JSON.stringify({ ...fixtureView(now), needs: [], beads: BEADS, ...(seq !== undefined ? { seq } : {}) }), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
}

async function rows() {
  return db.outbox.orderBy('id').toArray();
}

const titles = (store: ReturnType<typeof usePosternTodoStore>, list: string) => store.lists?.find((l) => l.id === list)?.cards.map((c) => c.title);

beforeEach(async () => {
  forgetOutboxState();
  await Promise.all([db.view.clear(), db.outbox.clear(), db.events.clear(), db.answers.clear(), db.settings.clear(), db.beadDetails.clear()]);
  await saveView(5);
});
afterEach(cleanup);

async function open() {
  const hook = renderHook(() => usePosternTodoStore());
  await waitFor(() => expect(hook.result.current.lists).toBeDefined());
  return hook;
}

describe('the Postern TodoStore: hand edits', () => {
  it('add queues a todo_add and shows the new card at the foot of its list, pending', async () => {
    const { result } = await open();
    await act(async () => result.current.add('mw-list', 'Buy bin bags'));
    expect(await rows()).toMatchObject([{ kind: 'action', payload: { action: { action: 'todo_add', list: 'mw-list', title: 'Buy bin bags' } } }]);
    await waitFor(() => expect(titles(result.current, 'mw-list')).toEqual(['Title of mw-list.1', 'Title of mw-list.2', 'Buy bin bags']));
    expect(result.current.lists?.[0].cards[2]).toMatchObject({ pending: true, adding: true });
  });

  it('edit queues a todo_edit and shows the new title, pending', async () => {
    const { result } = await open();
    await act(async () => result.current.edit('mw-list.2', { title: 'Renamed', notes: 'Some notes' }));
    expect(await rows()).toMatchObject([{ kind: 'action', bead: 'mw-list.2', payload: { action: { action: 'todo_edit', bead: 'mw-list.2', title: 'Renamed', notes: 'Some notes' } } }]);
    await waitFor(() => expect(titles(result.current, 'mw-list')).toEqual(['Title of mw-list.1', 'Renamed']));
    expect(result.current.lists?.[0].cards[1].pending).toBe(true);
  });

  it('move queues a todo_move and shows the new order and list, pending', async () => {
    const { result } = await open();
    await act(async () => result.current.move('mw-list.2', { before: 'mw-list.1' }));
    await act(async () => result.current.move('mw-list.1', { list: 'mw-other' }));
    expect((await rows()).map((row) => row.payload.action)).toEqual([
      { action: 'todo_move', bead: 'mw-list.2', before: 'mw-list.1' },
      { action: 'todo_move', bead: 'mw-list.1', list: 'mw-other' },
    ]);
    await waitFor(() => expect(titles(result.current, 'mw-list')).toEqual(['Title of mw-list.2']));
    expect(titles(result.current, 'mw-other')).toEqual(['Title of mw-other.1', 'Title of mw-list.1']);
  });

  it('rolls a change back with a notice when the backend refuses the row for good', async () => {
    const { result } = await open();
    await act(async () => result.current.move('mw-list.2', { before: 'mw-list.1' }));
    await waitFor(() => expect(titles(result.current, 'mw-list')?.[0]).toBe('Title of mw-list.2'));
    const [row] = await rows();
    await act(async () => outboxRepo.update(row.id as number, { state: 'failed', failure: 'The backend said no.' }));
    await waitFor(() => expect(titles(result.current, 'mw-list')).toEqual(['Title of mw-list.1', 'Title of mw-list.2']));
    expect(result.current.notices).toHaveLength(1);
  });

  it('rolls a change back with a note when the Mayor never echoes it, and a late echo takes the note away', async () => {
    const { result } = await open();
    await act(async () => result.current.edit('mw-list.2', { title: 'Renamed' }));
    const [row] = await rows();
    await act(async () => outboxRepo.update(row.id as number, { state: 'acked', txid: `direct:${'a'.repeat(64)}`, sentAt: Date.now() - REFUSED_AFTER_MS - 60_000 }));
    await waitFor(() => expect(titles(result.current, 'mw-list')).toEqual(['Title of mw-list.1', 'Title of mw-list.2']));
    await waitFor(() => expect(result.current.notices).toHaveLength(1));
    await act(async () => void (await db.events.put({ seq: 6, ts: '', kind: 'action_applied', bead: 'mw-list.2', actor: 'mw', from: '', to: '', detail: `direct:${'a'.repeat(64)}`, lane: 'normal' })));
    await waitFor(() => expect(result.current.notices).toHaveLength(0));
  });

  it('keeps a change on the board until the view has reached its echo, then lets the view show it', async () => {
    const { result } = await open();
    await act(async () => result.current.edit('mw-list.2', { title: 'Renamed' }));
    const [row] = await rows();
    await act(async () => {
      await outboxRepo.update(row.id as number, { state: 'acked', txid: `direct:${'b'.repeat(64)}`, sentAt: Date.now() });
      await db.events.put({ seq: 9, ts: '', kind: 'action_applied', bead: 'mw-list.2', actor: 'mw', from: '', to: '', detail: `direct:${'b'.repeat(64)}`, lane: 'normal' });
    });
    // the view is at seq 5, the echo at 9: still pending, still shown
    await waitFor(() => expect(result.current.lists?.[0].cards[1]).toMatchObject({ title: 'Renamed', pending: true }));
    BEADS[2] = bead('mw-list.2', { parent: 'mw-list', labels: ['hitl', 'hitl:todo'], title: 'Renamed by the Mayor' });
    await act(async () => saveView(9));
    await waitFor(() => expect(result.current.lists?.[0].cards[1]).toMatchObject({ title: 'Renamed by the Mayor' }));
    expect(result.current.lists?.[0].cards[1].pending).toBeUndefined();
  });
});
