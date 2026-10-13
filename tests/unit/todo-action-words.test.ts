// tests/unit/todo-action-words.test.ts — mw-ev7oyy.7: the three §13 todo_* actions read back from a message's plaintext
// (a todo_add has no bead) and say what they did in a channel.
import { describe, expect, it } from 'vitest';
import { decodeAction, describeAction } from '../../src/model/conversation';

describe('todo_* actions in a conversation', () => {
  it('reads a todo_add, which names a list and no bead', () => {
    expect(decodeAction(JSON.stringify({ action: 'todo_add', list: 'mw-abc', title: 'Buy bin bags' }))).toEqual({ action: 'todo_add', list: 'mw-abc', title: 'Buy bin bags' });
    expect(decodeAction(JSON.stringify({ action: 'todo_add', title: 'No list' }))).toBeUndefined();
  });

  it('reads a todo_edit and a todo_move with their fields', () => {
    expect(decodeAction(JSON.stringify({ action: 'todo_edit', bead: 'mw-abc.1', title: 'New', notes: '' }))).toEqual({ action: 'todo_edit', bead: 'mw-abc.1', title: 'New', notes: '' });
    expect(decodeAction(JSON.stringify({ action: 'todo_move', bead: 'mw-abc.1', list: 'mw-def', before: 'mw-def.2' }))).toEqual({ action: 'todo_move', bead: 'mw-abc.1', list: 'mw-def', before: 'mw-def.2' });
  });

  it('keeps a todo_edit due, set or cleared', () => {
    expect(decodeAction(JSON.stringify({ action: 'todo_edit', bead: 'mw-abc.1', due: '2026-10-14T09:00:00.000Z' }))).toEqual({ action: 'todo_edit', bead: 'mw-abc.1', due: '2026-10-14T09:00:00.000Z' });
    expect(decodeAction(JSON.stringify({ action: 'todo_edit', bead: 'mw-abc.1', due: '' }))).toEqual({ action: 'todo_edit', bead: 'mw-abc.1', due: '' });
  });

  it('keeps the other actions as they were', () => {
    expect(decodeAction(JSON.stringify({ action: 'close', bead: 'mw-abc', title: 'ignored' }))).toEqual({ action: 'close', bead: 'mw-abc' });
  });

  it('says what each did', () => {
    expect(describeAction({ action: 'todo_add', list: 'mw-abc', title: 'Buy bin bags' })).toBe('Added “Buy bin bags” to mw-abc');
    expect(describeAction({ action: 'todo_edit', bead: 'mw-abc.1' })).toBe('Edited mw-abc.1');
    expect(describeAction({ action: 'todo_move', bead: 'mw-abc.1' })).toBe('Moved mw-abc.1');
  });
});
