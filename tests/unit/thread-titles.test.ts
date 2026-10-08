// What a Talk row and a thread header call a thread (src/model/threads.ts titleFor):
// the bead's title from the live view, the bead id when the view does not hold it,
// a named channel's own name, and the Factory for the general thread.
import { describe, expect, it } from 'vitest';
import { GENERAL, summariseThreads, titleFor } from '../../src/model/threads';
import { indexView } from '../../src/model/tree';
import { threadKey } from '../../src/services/threads';
import { fixtureView } from '../support/cockpit-fixture';
import type { MessageRow } from '../../src/data/db';

const index = indexView(fixtureView());
const KNOWN = 'mw-f758y.30.2';

function received(id: string, thread: string | undefined, ts: number): MessageRow {
  return { id, txid: id, vout: 0, seq: ts, class: 'message', to: 'me', from: 'mayor', ts, ciphertext: '', plaintext: 'hello', direction: 'received', read: true, thread };
}

describe('titleFor', () => {
  it("gives a bead thread the bead's title from the view, the bead id beneath", () => {
    expect(titleFor(`bead:${KNOWN}`, index)).toEqual({ title: 'GET /api/events streams message and view changes', subtitle: KNOWN });
  });

  it('gives the bead id as the title when the view does not hold the bead', () => {
    expect(titleFor('bead:mw-nowhere.9', index)).toEqual({ title: 'mw-nowhere.9', subtitle: 'mw-nowhere.9' });
  });

  it('gives the bead id as the title when there is no view at all yet', () => {
    expect(titleFor(`bead:${KNOWN}`, undefined).title).toBe(KNOWN);
  });

  it("gives a named channel its own name, whatever the view holds", () => {
    expect(titleFor(threadKey({ topic: 'launch plan' })!, index)).toEqual({ title: 'launch plan', subtitle: 'Channel' });
  });

  it('calls the general thread the Factory', () => {
    expect(titleFor(GENERAL, index).title).toBe('Factory');
  });
});

describe('the titles on the Talk list', () => {
  it('titles each row the same way: the view\'s title, the id as the fallback, a channel by name', () => {
    const rows = [
      received('a', `bead:${KNOWN}`, 300),
      received('b', 'bead:mw-nowhere.9', 200),
      received('c', threadKey({ topic: 'launch plan' })!, 100),
    ];
    const titles = summariseThreads(rows, index).map((thread) => thread.title);
    expect(titles).toEqual(['Factory', 'GET /api/events streams message and view changes', 'mw-nowhere.9', 'launch plan']);
  });
});
