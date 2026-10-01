// mw-j0f2d.29: an answer that comes while he has left the app is unspoken until he returns.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialTalkLine, talkLine, type TalkLineEvent, type TalkLineState } from '../../src/model/talkLine';
import { notificationSpecForTalkAnswer, TALK_ANSWER_TAG } from '../../src/push/classOptions';
import { silentWavUrl, holdVoiceAlive } from '../../src/services/silentLoop';
import { announceAnswer, clearAnnouncement } from '../../src/services/talkAnswerNotice';

function run(events: TalkLineEvent[], from: TalkLineState = initialTalkLine): TalkLineState {
  return events.reduce(talkLine, from);
}

const waiting = run([
  { type: 'hold', talkId: 't1' },
  { type: 'release', text: 'what landed?' },
  { type: 'sent', at: 1000 },
]);
const answer = (text: string, hidden?: boolean): TalkLineEvent => ({ type: 'incoming', turn: { talk: { id: 't1', turn: 1 }, text, role: 'answer' }, ...(hidden === undefined ? {} : { hidden }) });

describe('the unspoken flag', () => {
  it('is set on an answer that arrives while hidden, and not on one that arrives visible', () => {
    expect(run([answer('Done.', true)], waiting).speaking).toEqual({ text: 'Done.', holding: false, unspoken: true });
    expect(run([answer('Done.', false)], waiting).speaking).toEqual({ text: 'Done.', holding: false });
    expect(run([answer('Done.')], waiting).speaking?.unspoken).toBeUndefined();
  });

  it('is cleared by visible, once, and the answer then speaks and ends the line', () => {
    const away = run([answer('Done.', true)], waiting);
    const back = talkLine(away, { type: 'visible' });
    expect(back.phase).toBe('speaking');
    expect(back.speaking?.unspoken).toBeUndefined();
    expect(talkLine(back, { type: 'visible' })).toBe(back);
    expect(talkLine(back, { type: 'spoken' }).phase).toBe('idle');
  });

  it('means a visible event does nothing to a line that is not holding an unspoken answer', () => {
    expect(talkLine(waiting, { type: 'visible' })).toBe(waiting);
    expect(talkLine(initialTalkLine, { type: 'visible' })).toBe(initialTalkLine);
  });

  it('is replaced by a cut: the unspoken answer can be dismissed', () => {
    expect(talkLine(run([answer('Done.', true)], waiting), { type: 'cut' }).phase).toBe('idle');
  });

  it('is never set by a holding answer, which is dropped while hidden', () => {
    const holding: TalkLineEvent = { type: 'incoming', turn: { talk: { id: 't1', turn: 1 }, text: 'One moment.', role: 'holding' }, hidden: true };
    expect(talkLine(waiting, holding)).toBe(waiting);
  });
});

describe('the announcement', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true, writable: true });
  });

  it('is the title, the chime buzz and nothing else', () => {
    const spec = notificationSpecForTalkAnswer();
    expect(spec.title).toBe('The Mayor answered');
    expect(spec.options.vibrate).toEqual([120]);
    expect(spec.options.tag).toBe(TALK_ANSWER_TAG);
    expect(spec.options.body).toBeUndefined();
    expect(spec.options.data).toEqual({ txid: '', class: 'talk', url: '/?v=line' });
  });

  it('shows the notification through the service worker when it is allowed', async () => {
    const showNotification = vi.fn(() => Promise.resolve());
    vi.stubGlobal('Notification', { permission: 'granted' });
    Object.defineProperty(navigator, 'serviceWorker', { value: { getRegistration: () => Promise.resolve({ showNotification }) }, configurable: true, writable: true });
    expect(await announceAnswer()).toBe('notification');
    expect(showNotification).toHaveBeenCalledWith('The Mayor answered', expect.objectContaining({ tag: TALK_ANSWER_TAG }));
  });

  it('gives the chime alone when notifications are not allowed', async () => {
    const buzz = vi.fn(() => true);
    vi.stubGlobal('Notification', { permission: 'denied' });
    Object.defineProperty(navigator, 'vibrate', { value: buzz, configurable: true, writable: true });
    expect(await announceAnswer()).toBe('chime');
    expect(buzz).toHaveBeenCalled();
  });

  it('takes the notification down once he is back', async () => {
    const close = vi.fn();
    const getNotifications = vi.fn(() => Promise.resolve([{ close }]));
    Object.defineProperty(navigator, 'serviceWorker', { value: { getRegistration: () => Promise.resolve({ getNotifications }) }, configurable: true, writable: true });
    await clearAnnouncement();
    expect(getNotifications).toHaveBeenCalledWith({ tag: TALK_ANSWER_TAG });
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('the silent loop', () => {
  it('is a valid WAV whose samples are all zero', () => {
    const url = silentWavUrl();
    expect(url.startsWith('data:audio/wav;base64,')).toBe(true);
    const bytes = Uint8Array.from(atob(url.split(',')[1]), (c) => c.charCodeAt(0));
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WAVE');
    expect(bytes.slice(44).every((b) => b === 0)).toBe(true);
  });

  it('plays looped, and pauses when released', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play');
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause');
    const release = holdVoiceAlive();
    expect(play).toHaveBeenCalledTimes(1);
    release();
    expect(pause).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});
