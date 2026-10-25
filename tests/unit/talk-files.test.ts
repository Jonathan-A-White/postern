// mw-6j8xmr: a Talk turn carries every picture and file chosen for it, in §8's shape as a message does: one as
// `attachment`, two or more as `attachments`. The line keeps them in the order chosen; Remove takes one away.
import { describe, expect, it } from 'vitest';
import { ATTACHMENT_ROOM_BYTES, MAX_TALK_FILES, TURN_TEXT_MAX_BYTES, initialTalkLine, talkLine, turnRecords, type TalkLineEvent, type TalkLineState, type TalkPicture } from '../../src/model/talkLine';
import { decodeTurn, encodeTurn } from '../../src/services/talk';
import { attachmentsOf } from '../../src/services/threads';

const attachment = (name: string, mime = 'image/jpeg') => ({ hash: name.charCodeAt(0).toString(16).padStart(2, '0').repeat(32), size: 100, mime, name });
const base = { talk: { id: 't1', turn: 1 }, text: 'look at these', role: 'turn' as const };
const file = (name: string, type = 'image/jpeg'): TalkPicture => ({ name, type, bytes: new Uint8Array([1, 2, 3]), ...(type.startsWith('image/') ? { preview: `blob:${name}` } : {}) });
const feed = (events: TalkLineEvent[], from: TalkLineState = initialTalkLine) => events.reduce(talkLine, from);
const attaching = (...names: string[]): TalkLineEvent[] => names.map((name) => ({ type: 'attach', picture: file(name, name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg') }));

describe('a Talk turn with several files on the wire', () => {
  it('writes one file as `attachment` and two or more as `attachments`, in order, never both', () => {
    const one = JSON.parse(encodeTurn({ ...base, attachments: [attachment('a.jpg')] }));
    expect(one.attachment).toEqual(attachment('a.jpg'));
    expect(one).not.toHaveProperty('attachments');
    const five = [attachment('a.jpg'), attachment('b.jpg'), attachment('c.jpg'), attachment('d.pdf', 'application/pdf'), attachment('e.txt', 'text/plain')];
    const wire = JSON.parse(encodeTurn({ ...base, attachments: five }));
    expect(wire.attachments).toEqual(five);
    expect(wire).not.toHaveProperty('attachment');
  });

  it('reads them back in order, whichever shape was written', () => {
    const five = [attachment('a.jpg'), attachment('b.jpg'), attachment('c.jpg'), attachment('d.pdf', 'application/pdf'), attachment('e.txt', 'text/plain')];
    const decoded = decodeTurn(encodeTurn({ ...base, attachments: five }));
    expect(attachmentsOf(decoded!)).toEqual(five);
    expect(attachmentsOf(decodeTurn(encodeTurn({ ...base, attachments: five.slice(0, 1) }))!)).toEqual(five.slice(0, 1));
  });

  it('still reads a turn an older build wrote with `attachment`', () => {
    expect(attachmentsOf(decodeTurn(JSON.stringify({ talk: base.talk, text: 'x', role: 'turn', attachment: attachment('old.jpg') }))!)).toEqual([attachment('old.jpg')]);
  });

  it('a turn with none has neither key, and a list holding a malformed file is read as none', () => {
    expect(Object.keys(JSON.parse(encodeTurn(base)))).not.toContain('attachments');
    const bad = JSON.stringify({ talk: base.talk, text: 'x', role: 'turn', attachments: [attachment('a.jpg'), { hash: 'x' }] });
    expect(attachmentsOf(decodeTurn(bad)!)).toEqual([]);
  });

  it('writes only the four keys of §8 for each file', () => {
    const wide = [{ ...attachment('a.jpg'), extra: 1 }, { ...attachment('b.jpg'), extra: 2 }];
    for (const written of JSON.parse(encodeTurn({ ...base, attachments: wide })).attachments) expect(Object.keys(written).sort()).toEqual(['hash', 'mime', 'name', 'size']);
  });
});

describe('the line and the files chosen for the next turn', () => {
  it('keeps 3 pictures and 2 files in the order chosen', () => {
    const state = feed(attaching('a.jpg', 'b.jpg', 'c.jpg', 'd.pdf', 'e.pdf'));
    expect(state.pictures.map((p) => p.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.pdf', 'e.pdf']);
  });

  it('Remove takes away the one it names and keeps the rest in order', () => {
    const state = feed([{ type: 'detach', index: 1 }], feed(attaching('a.jpg', 'b.jpg', 'c.jpg')));
    expect(state.pictures.map((p) => p.name)).toEqual(['a.jpg', 'c.jpg']);
    expect(feed([{ type: 'detach', index: 7 }], state)).toBe(state);
  });

  it(`takes no more than ${MAX_TALK_FILES} files for one turn`, () => {
    const names = Array.from({ length: MAX_TALK_FILES + 3 }, (_, i) => `p${i}.jpg`);
    expect(feed(attaching(...names)).pictures).toHaveLength(MAX_TALK_FILES);
  });

  it('one send carries them all and spends them', () => {
    const chosen = feed(attaching('a.jpg', 'b.jpg', 'c.jpg', 'd.pdf', 'e.pdf'));
    const sending = feed([{ type: 'hold', talkId: 't1' }, { type: 'release', text: 'all of these' }], chosen);
    expect(sending.outgoingPictures?.map((p) => p.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.pdf', 'e.pdf']);
    expect(sending.pictures).toEqual([]);
    const bare = feed([{ type: 'sendPicture', talkId: 't1' }], chosen);
    expect(bare.outgoing).toMatchObject({ text: '', role: 'turn' });
    expect(bare.outgoingPictures).toHaveLength(5);
  });

  it('a turn that failed to send keeps all of its files for Try again', () => {
    const failed = feed([{ type: 'sendPicture', talkId: 't1' }, { type: 'sendFailed' }], feed(attaching('a.jpg', 'b.jpg', 'c.pdf')));
    expect(failed.unsentPictures).toHaveLength(3);
    expect(feed([{ type: 'retry' }], failed).outgoingPictures?.map((p) => p.name)).toEqual(['a.jpg', 'b.jpg', 'c.pdf']);
  });

  it('speaking again after a failed send gives the files back to the next turn', () => {
    const failed = feed([{ type: 'sendPicture', talkId: 't1' }, { type: 'sendFailed' }], feed(attaching('a.jpg', 'b.jpg')));
    expect(feed([{ type: 'hold', talkId: 't1' }], failed).pictures.map((p) => p.name)).toEqual(['a.jpg', 'b.jpg']);
  });
});

describe('his words in parts when several files go with them', () => {
  const bytes = (text: string) => new TextEncoder().encode(text).length;

  it('part 1 gives up room for every file, so the sealed record stays under its limit', () => {
    const long = 'a'.repeat(TURN_TEXT_MAX_BYTES - 100);
    const turn = { ...base, text: long };
    expect(turnRecords(turn, 0)).toHaveLength(1);
    for (const files of [1, 2, 5]) {
      const records = turnRecords(turn, files);
      expect(records.map((r) => r.text).join('')).toBe(long);
      expect(bytes(records[0].text)).toBeLessThanOrEqual(TURN_TEXT_MAX_BYTES - ATTACHMENT_ROOM_BYTES * files);
    }
  });

  it('the files go on part 1 only', () => {
    const records = turnRecords({ ...base, text: 'a'.repeat(TURN_TEXT_MAX_BYTES + 10), attachments: [attachment('a.jpg'), attachment('b.jpg')] }, 2);
    expect(records[0].attachments).toHaveLength(2);
    expect(records[1]).not.toHaveProperty('attachments');
  });
});
