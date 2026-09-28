// plans/0021 decision 10: a thread reads as a conversation — never JSON — with
// the bead's own comments merged in, the ones that merely record a Postern
// message left out, and a voice note's transcript folded under it. And one
// search box finds beads, comments and messages.
import { describe, it, expect } from 'vitest';
import { mergeConversation, previewText, speakerOfComment } from '../../src/model/conversation';
import { search } from '../../src/model/search';
import { encodeQuestion, encodeReply } from '../../src/services/questions';
import { encodeThreadedMessage } from '../../src/services/threads';
import type { MessageRow } from '../../src/data/db';
import { fixtureView } from '../support/cockpit-fixture';

let seq = 0;
function row(plaintext: string, overrides: Partial<MessageRow> = {}): MessageRow {
  seq += 1;
  const txid = overrides.txid ?? `direct:${String(seq).padStart(64, '0')}`;
  return {
    id: `${txid}:0`,
    txid,
    vout: 0,
    seq,
    class: 'message',
    to: 't',
    from: 'f',
    ts: 1_760_000_000 + seq * 60,
    ciphertext: '',
    plaintext,
    direction: 'received',
    read: false,
    ...overrides,
  };
}

describe('previewText', () => {
  it('reads every kind of plaintext as words', () => {
    expect(previewText(row(encodeQuestion({ bead: 'b', q: 'A or B?', rec: 'A', options: ['A', 'B'] }), { class: 'decision-needed' }))).toBe('A or B?');
    expect(previewText(row(encodeReply({ bead: 'b', answer: 'A' })))).toBe('Answered: A');
    expect(previewText(row(JSON.stringify({ action: 'release', bead: 'mw-x' })))).toBe('Released mw-x');
    expect(previewText(row(JSON.stringify({ action: 'priority', bead: 'mw-x', priority: 0 })))).toBe('Set mw-x to P0');
    expect(previewText(row(encodeThreadedMessage({ thread: { bead: 'b' }, text: 'hi' })))).toBe('hi');
    expect(previewText(row(encodeThreadedMessage({ text: '', attachment: { hash: 'h', size: 1, mime: 'audio/webm' } })))).toBe('Voice note');
    expect(previewText(row(encodeThreadedMessage({ text: 'look', attachment: { hash: 'h', size: 1, mime: 'image/png' } })))).toBe('Image · look');
    expect(previewText(row('plain words'))).toBe('plain words');
    expect(previewText({ plaintext: undefined, class: 'message', decryptFailed: false })).toMatch(/unlock/i);
  });
});

describe('mergeConversation', () => {
  it('merges comments and messages by time, drops comments that record a message, and folds transcripts in', () => {
    const voice = row(encodeThreadedMessage({ thread: { bead: 'b' }, text: '', attachment: { hash: 'h', size: 9, mime: 'audio/webm' } }), { direction: 'sent', ts: 1_760_000_100 });
    const transcript = row(encodeThreadedMessage({ thread: { bead: 'b' }, text: 'what was heard', re: voice.txid, role: 'transcript' }), { ts: 1_760_000_110 });
    const reply = row(encodeThreadedMessage({ thread: { bead: 'b' }, text: 'on it' }), { ts: 1_760_000_120 });
    const comments = [
      { at: new Date(1_760_000_050 * 1000).toISOString(), author: 'mw@desktop', text: 'Claimed.' },
      { at: new Date(1_760_000_105 * 1000).toISOString(), author: 'root', text: `GOVERNOR (voice) via postern, txid ${voice.txid}: what was heard` },
    ];
    const items = mergeConversation([voice, transcript, reply], comments);
    expect(items.map((item) => item.text)).toEqual(['Claimed.', '', 'on it']);
    expect(items[0]).toMatchObject({ speaker: 'builder', source: 'comment' });
    expect(items[1]).toMatchObject({ speaker: 'you', kind: 'attachment', transcript: 'what was heard' });
    expect(items[2]).toMatchObject({ speaker: 'mayor', unread: true });
  });

  // mw-f758y.24: `mw postern inbox` records the Governor's message on the bead as
  // 'The Governor by postern <RFC3339 ts>: <text> [image: <desktop path>]', with no txid.
  describe("the hook's comment recording his message", () => {
    const ts = 1_760_000_300;
    const stamp = new Date(ts * 1000).toISOString().replace('.000Z', 'Z');
    const path = '/home/jwhite/.local/state/mw/postern/inbox/direct-3f22.jpg';
    const image = () =>
      row(encodeThreadedMessage({ thread: { bead: 'b' }, text: 'the tiles', attachment: { hash: 'h', size: 9, mime: 'image/jpeg' } }), { direction: 'sent', ts });

    it('is left out when the message itself is in the thread, so the picture shows and its desktop path does not', () => {
      const comment = { at: new Date((ts + 30) * 1000).toISOString(), author: 'root', text: `The Governor by postern ${stamp}: the tiles [image: ${path}]` };
      const items = mergeConversation([image()], [comment]);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ speaker: 'you', kind: 'attachment', attachment: { mime: 'image/jpeg' } });
      expect(JSON.stringify(items)).not.toContain('/home/jwhite');
    });

    it('is his words without the desktop path when the message is not on this phone', () => {
      const comment = { at: new Date((ts + 30) * 1000).toISOString(), author: 'root', text: `The Governor by postern ${stamp}: the tiles [image: ${path}]` };
      const items = mergeConversation([], [comment]);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ speaker: 'you', kind: 'comment', text: 'the tiles (image)' });
      expect(items[0].text).not.toContain('/home/jwhite');
    });

    it('leaves a comment about some other time, or by someone else, alone', () => {
      const other = `The Governor by postern ${new Date((ts + 500) * 1000).toISOString().replace('.000Z', 'Z')}: later`;
      const items = mergeConversation([image()], [
        { at: new Date((ts + 500) * 1000).toISOString(), author: 'root', text: other },
        { at: new Date((ts + 600) * 1000).toISOString(), author: 'root', text: 'Mentions [image: /tmp/x.jpg] in passing' },
      ]);
      expect(items.map((item) => item.text)).toEqual(['the tiles', 'later', 'Mentions [image: /tmp/x.jpg] in passing']);
    });
  });

  it('names who wrote a comment', () => {
    expect(speakerOfComment('root').speaker).toBe('mayor');
    expect(speakerOfComment('mw@laptop')).toEqual({ speaker: 'builder', label: 'Builder · laptop' });
    expect(speakerOfComment('luke').label).toBe('luke');
  });
});

describe('search', () => {
  const view = fixtureView(Date.parse('2026-09-28T12:00:00Z'));

  it('ranks an exact id first and finds comments and messages too', () => {
    const hits = search('mw-2rbm.10', { beads: view.beads, details: [], messages: [] });
    expect(hits[0]).toMatchObject({ kind: 'bead', bead: 'mw-2rbm.10' });

    const all = search('ping', {
      beads: view.beads,
      details: [{ v: 2, id: 'mw-f758y.30.2', title: 'T', type: 'task', status: 'open', priority: 2, labels: [], assignee: '', waits: [], blocks: [], children: [], created: '', updated: '', started: '', closed: '', attempts: 0, description: '', acceptance: 'a ping every 25 s', comments: [{ at: 'a', author: 'root', text: 'the ping idles' }] }],
      messages: [row(encodeThreadedMessage({ thread: { bead: 'mw-f758y.30.2' }, text: 'make the ping 25 s' }), { thread: 'bead:mw-f758y.30.2' })],
    });
    expect(new Set(all.map((hit) => hit.kind))).toEqual(new Set(['bead', 'comment', 'message']));
    expect(all.find((hit) => hit.kind === 'message')?.thread).toBe('bead:mw-f758y.30.2');
  });

  it('requires every word', () => {
    expect(search('ping banana', { beads: view.beads, details: [], messages: [] })).toEqual([]);
  });
});
