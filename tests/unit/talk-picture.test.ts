// mw-q6n8m0.14: a Talk turn may carry one picture, in §8's shape; the line holds one chosen picture at a time.
import { describe, expect, it } from 'vitest';
import { ATTACHMENT_ROOM_BYTES, TURN_TEXT_MAX_BYTES, initialTalkLine, talkLine, turnRecords, type TalkLineState, type TalkPicture } from '../../src/model/talkLine';
import { decodeTurn, encodeTurn } from '../../src/services/talk';

const attachment = { hash: 'ab'.repeat(32), size: 1234, mime: 'image/jpeg', name: 'screen.jpg' };
const base = { talk: { id: 't1', turn: 1 }, text: 'look at this', role: 'turn' as const };
const picture = (name: string): TalkPicture => ({ name, type: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]), preview: `blob:${name}` });

describe('a Talk turn with a picture', () => {
  it('round-trips the attachment in the exact shape of §8', () => {
    const decoded = decodeTurn(encodeTurn({ ...base, attachment }));
    expect(decoded?.attachment).toEqual(attachment);
  });

  it('round-trips an attachment with no name', () => {
    const bare = { hash: attachment.hash, size: attachment.size, mime: attachment.mime };
    expect(decodeTurn(encodeTurn({ ...base, attachment: bare }))?.attachment).toEqual(bare);
  });

  it('writes no attachment key at all for a turn without one', () => {
    expect(Object.keys(JSON.parse(encodeTurn(base)))).not.toContain('attachment');
    expect(decodeTurn(encodeTurn(base))).not.toHaveProperty('attachment');
  });

  it('writes only the four keys of §8, whatever else the object carries', () => {
    const wide = { ...attachment, extra: 'x' } as typeof attachment;
    expect(Object.keys(JSON.parse(encodeTurn({ ...base, attachment: wide })).attachment).sort()).toEqual(['hash', 'mime', 'name', 'size']);
  });

  it('reads a malformed attachment as no attachment', () => {
    for (const bad of [{ hash: 'x' }, 'file', null, { ...attachment, size: 'big' }, { ...attachment, hash: '' }]) {
      const plaintext = JSON.stringify({ talk: base.talk, text: 'hi', role: 'turn', attachment: bad });
      expect(decodeTurn(plaintext)).not.toHaveProperty('attachment');
    }
  });
});

describe('the line and its one picture', () => {
  const listening = (state: TalkLineState = initialTalkLine) => talkLine(state, { type: 'hold', talkId: 't1' });

  it('keeps one picture: a second choice replaces the first', () => {
    const state = talkLine(talkLine(initialTalkLine, { type: 'attach', picture: picture('a.jpg') }), { type: 'attach', picture: picture('b.jpg') });
    expect(state.picture?.name).toBe('b.jpg');
  });

  it('Remove drops the picture', () => {
    const state = talkLine(talkLine(initialTalkLine, { type: 'attach', picture: picture('a.jpg') }), { type: 'detach' });
    expect(state.picture).toBeUndefined();
  });

  it('a release with words sends the turn with the picture and clears it', () => {
    const state = talkLine(listening(talkLine(initialTalkLine, { type: 'attach', picture: picture('a.jpg') })), { type: 'release', text: 'hello' });
    expect(state.phase).toBe('sending');
    expect(state.outgoing).toMatchObject({ text: 'hello', role: 'turn' });
    expect(state.outgoingPicture?.name).toBe('a.jpg');
    expect(state.picture).toBeUndefined();
  });

  it('a release with no words and no picture sends nothing', () => {
    expect(talkLine(listening(), { type: 'release', text: ' ' }).phase).toBe('idle');
  });

  it('Send with a picture and nothing said sends a turn with empty text', () => {
    const state = talkLine(talkLine(initialTalkLine, { type: 'attach', picture: picture('a.jpg') }), { type: 'sendPicture', talkId: 't1' });
    expect(state.phase).toBe('sending');
    expect(state.outgoing).toMatchObject({ text: '', role: 'turn', talk: { id: 't1', turn: 1 } });
    expect(state.outgoingPicture?.name).toBe('a.jpg');
  });

  it('Send with no picture does nothing, and neither does it while the line waits', () => {
    expect(talkLine(initialTalkLine, { type: 'sendPicture', talkId: 't1' })).toBe(initialTalkLine);
    const waiting = talkLine(talkLine(talkLine(listening(talkLine(initialTalkLine, { type: 'attach', picture: picture('a.jpg') })), { type: 'release', text: 'hi' }), { type: 'sent', at: 1 }), { type: 'attach', picture: picture('b.jpg') });
    expect(waiting.phase).toBe('waiting');
    expect(talkLine(waiting, { type: 'sendPicture', talkId: 't1' })).toBe(waiting);
  });

  it('a turn that failed to send keeps its picture for Try again', () => {
    const sending = talkLine(talkLine(initialTalkLine, { type: 'attach', picture: picture('a.jpg') }), { type: 'sendPicture', talkId: 't1' });
    const failed = talkLine(sending, { type: 'sendFailed' });
    expect(failed.unsentPicture?.name).toBe('a.jpg');
    const retrying = talkLine(failed, { type: 'retry' });
    expect(retrying.outgoingPicture?.name).toBe('a.jpg');
  });

  it('a picture chosen while waiting stays for the next turn', () => {
    const sent = talkLine(talkLine(listening(), { type: 'release', text: 'first' }), { type: 'sent', at: 1 });
    const chosen = talkLine(sent, { type: 'attach', picture: picture('a.jpg') });
    expect(chosen.picture?.name).toBe('a.jpg');
  });

  it('sends his words in parts sooner when a picture goes with them, so the sealed record stays under its limit', () => {
    const long = 'a'.repeat(TURN_TEXT_MAX_BYTES - 100);
    const withPicture = talkLine(listening(talkLine(initialTalkLine, { type: 'attach', picture: picture('a.jpg') })), { type: 'release', text: long });
    const without = talkLine(listening(), { type: 'release', text: long });
    expect(turnRecords(withPicture.outgoing!, true).map((r) => r.text).join('')).toBe(long);
    expect(turnRecords(withPicture.outgoing!, true).length).toBe(2);
    expect(turnRecords(without.outgoing!, false)).toHaveLength(1);
    expect(new TextEncoder().encode(turnRecords(withPicture.outgoing!, true)[0].text).length).toBeLessThanOrEqual(TURN_TEXT_MAX_BYTES - ATTACHMENT_ROOM_BYTES);
  });
});
