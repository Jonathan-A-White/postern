// features/steps/talk-line.steps.tsx — runs features/talk-line.feature
// (mw-j0f2d.7): the turn plaintext of docs/protocol.md §20, its delivery as class
// `talk`, the pure Talk line state machine, and the real Talk screen, tab bar and
// Needs screen against a Dexie holding a talk record.
import '@testing-library/react/dont-cleanup-after-each';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { P2PKH, PrivateKey, Script, Transaction, Utils } from '@bsv/sdk';
import { decodeRecordScript } from 'spell-forge-bsv';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { NeedsScreen } from '../../src/cockpit/NeedsScreen';
import { Shell } from '../../src/cockpit/Shell';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { db, type MessageRow } from '../../src/data/db';
import { ANCHOR_ADDRESS, decryptMessage, type MessagePayload } from '../../src/services/messages';
import { decodeTurn, deliverTurn, encodeTurn } from '../../src/services/talk';
import { decodeCall, deliverCallRequest } from '../../src/services/call';
import { deliver, settledWrites, type Delivered } from '../../src/services/deliver';
import { notificationSpecForTalkAnswer } from '../../src/push/classOptions';
import { initialTalkLine, talkLine, TURN_TEXT_MAX_BYTES, type TalkLineEvent, type TalkLineState, type TalkTurn } from '../../src/model/talkLine';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';
import { backendDownWoc, type BackendDownWoc } from '../../tests/support/fake-woc';

const MAYOR = PrivateKey.fromHex('77'.repeat(32));
const HIM_KEY = new Uint8Array(Utils.toArray('45'.repeat(32), 'hex'));
const HIM_PUB = PrivateKey.fromHex('45'.repeat(32)).toPublicKey().toString();

// round trip
let turn: TalkTurn;
let decoded: TalkTurn | undefined;
let encoded = '';
let posts: { scriptHex: string }[] = [];

// the backend that cannot be reached
let down: BackendDownWoc;
let delivered: Delivered | undefined;
let failure: unknown;

// the line
let line: TalkLineState = initialTalkLine;
/** Whether the Mayor is here, as the scenario's ticks tell the line. */
let mayorHere: boolean | undefined;
const feed = (event: TalkLineEvent) => {
  line = talkLine(line, event);
};

function turnOf(talkId: string, n: number, text: string, extra: { model?: string; cut?: boolean } = {}): TalkTurn {
  return { talk: { id: talkId, turn: n }, text, role: 'turn', ...(extra.model ? { model: extra.model } : {}), ...(extra.cut ? { cut: true } : {}) };
}

/** A line waiting on turn `n` of `talkId`, got there by the events a person would cause. */
function waitingOn(talkId: string, n: number, sentAt = 1000, here?: boolean): void {
  line = initialTalkLine;
  for (let i = 1; i <= n; i += 1) {
    feed({ type: 'hold', talkId });
    feed({ type: 'release', text: `turn ${i}` });
    feed({ type: 'sent', at: sentAt, here });
    if (i < n) feed({ type: 'incoming', turn: { talk: { id: talkId, turn: i }, text: 'ok', role: 'answer' } });
    if (i < n) feed({ type: 'spoken' });
  }
}

function speakingFor(talkId: string, n: number, text: string): void {
  waitingOn(talkId, n);
  feed({ type: 'incoming', turn: { talk: { id: talkId, turn: n }, text, role: 'answer' } });
}

// the screens
let stored: MessageRow[] = [];

function row(txid: string, text: string, cls: MessageRow['class']): MessageRow {
  return {
    id: `${txid}:0`,
    txid,
    vout: 0,
    seq: 1,
    class: cls,
    to: HIM_PUB,
    from: MAYOR.toPublicKey().toString(),
    ts: Math.floor(Date.now() / 1000) - 60,
    ciphertext: '',
    plaintext: text,
    direction: 'received',
    read: false,
  };
}

afterAll(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/talk-line.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    line = initialTalkLine;
    mayorHere = undefined;
    posts = [];
    stored = [];
    await db.messages.clear();
    await db.view.clear();
    await db.settings.clear();
  });

  Scenario('AC-1: a turn survives encode and decode', ({ Given, When, Then, And }) => {
    Given('a turn {number} of talk {string} saying {string} on model {string} after a cut', (_c, n: number, id: string, text: string, model: string) => {
      turn = turnOf(id, Number(n), text, { model, cut: true });
    });
    When('the turn is encoded and decoded', () => {
      encoded = encodeTurn(turn);
      decoded = decodeTurn(encoded);
    });
    Then('the decoded turn is the one he made', () => expect(decoded).toEqual(turn));
    And('the encoded turn names the talk {string} and turn {number}', (_c, id: string, n: number) => {
      expect(JSON.parse(encoded)).toMatchObject({ talk: { id, turn: Number(n) }, role: 'turn', model: 'sonnet', cut: true });
    });
  });

  Scenario('AC-1: optional fields stay out of a turn that does not use them', ({ Given, When, Then, And }) => {
    Given('a turn {number} of talk {string} saying {string} on no model without a cut', (_c, n: number, id: string, text: string) => {
      turn = turnOf(id, Number(n), text);
    });
    When('the turn is encoded and decoded', () => {
      encoded = encodeTurn(turn);
      decoded = decodeTurn(encoded);
    });
    Then('the decoded turn is the one he made', () => expect(decoded).toEqual(turn));
    And('the encoded turn has no model and no cut', () => {
      const parsed = JSON.parse(encoded);
      expect(parsed).not.toHaveProperty('model');
      expect(parsed).not.toHaveProperty('cut');
    });
  });

  Scenario('AC-1: words that are not a turn do not decode as one', ({ Then }) => {
    Then('plain text, a message body and a malformed turn all decode to nothing', () => {
      expect(decodeTurn('What landed today?')).toBeUndefined();
      expect(decodeTurn(JSON.stringify({ text: 'hello' }))).toBeUndefined();
      expect(decodeTurn(JSON.stringify({ talk: { id: 'x', turn: 1 }, text: 'hi', role: 'shout' }))).toBeUndefined();
      expect(decodeTurn(JSON.stringify({ talk: { id: 'x', turn: 'one' }, text: 'hi', role: 'turn' }))).toBeUndefined();
      expect(decodeTurn(JSON.stringify({ talk: { id: '', turn: 1 }, text: 'hi', role: 'turn' }))).toBeUndefined();
      expect(decodeTurn(JSON.stringify({ talk: { id: 'x', turn: 1 }, role: 'turn' }))).toBeUndefined();
    });
  });

  Scenario('AC-1: a turn is delivered as class talk to the Mayor', ({ Given, When, Then, And }) => {
    Given("the Mayor's key is known", () => {
      posts = [];
    });
    When('he delivers a turn {number} of talk {string} saying {string}', async (_c, n: number, id: string, text: string) => {
      turn = turnOf(id, Number(n), text);
      const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (isChallengeRequest(String(url))) return challengeResponse();
        posts.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ txid: `direct:${'d'.repeat(64)}` }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      });
      await deliverTurn(turn, { key: HIM_KEY, mayorKey: MAYOR.toPublicKey().toString(), direct: true, fetchImpl: fetchImpl as unknown as typeof fetch });
      await settledWrites();
    });
    const payloadOfPost = (): MessagePayload => {
      const script = decodeRecordScript(Script.fromHex(posts[0].scriptHex));
      return JSON.parse(Utils.toUTF8(Array.from(script!.payloadBytes))) as MessagePayload;
    };
    Then('one record of class {string} is posted to the Mayor', (_c, cls: string) => {
      expect(posts).toHaveLength(1);
      const payload = payloadOfPost();
      expect(payload.class).toBe(cls);
      expect(payload.to).toBe(MAYOR.toPublicKey().toString());
      expect(payload.from).toBe(HIM_PUB);
    });
    And('the Mayor reads the turn he made', () => {
      expect(decodeTurn(decryptMessage(payloadOfPost(), MAYOR.toHex()))).toEqual(turn);
    });
    And('no summary rides in the clear', () => {
      expect(payloadOfPost()).not.toHaveProperty('summary');
    });
  });

  Scenario('AC-1: Call me sends a call request: a record of class call with the words and the time', ({ Given, When, Then, And }) => {
    Given("the Mayor's key is known", () => {
      posts = [];
    });
    When('he delivers a call request saying {string} at {number}', async (_c, text: string, at: number) => {
      const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (isChallengeRequest(String(url))) return challengeResponse();
        posts.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ txid: `direct:${'e'.repeat(64)}` }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      });
      await deliverCallRequest(text, Number(at), { key: HIM_KEY, mayorKey: MAYOR.toPublicKey().toString(), direct: true, fetchImpl: fetchImpl as unknown as typeof fetch });
      await settledWrites();
    });
    const payloadOfPost = (): MessagePayload => {
      const script = decodeRecordScript(Script.fromHex(posts[0].scriptHex));
      return JSON.parse(Utils.toUTF8(Array.from(script!.payloadBytes))) as MessagePayload;
    };
    Then('one record of class {string} is posted to the Mayor', (_c, cls: string) => {
      expect(posts).toHaveLength(1);
      const payload = payloadOfPost();
      expect(payload.class).toBe(cls);
      expect(payload.to).toBe(MAYOR.toPublicKey().toString());
      expect(payload.from).toBe(HIM_PUB);
    });
    And('the Mayor reads a request saying {string} at {number}', (_c, text: string, at: number) => {
      expect(decodeCall(decryptMessage(payloadOfPost(), MAYOR.toHex()))).toEqual({ role: 'request', text, at: Number(at) });
    });
    And('no summary rides in the clear', () => {
      expect(payloadOfPost()).not.toHaveProperty('summary');
    });
  });

  Scenario('AC-2: holding the button listens, and releasing with words sends a turn', ({ Given, When, Then, And }) => {
    Given('the line is idle', () => {
      line = initialTalkLine;
    });
    When('he holds the button for talk {string}', (_c, id: string) => feed({ type: 'hold', talkId: id }));
    Then('the line is listening', () => expect(line.phase).toBe('listening'));
    When('he releases with the words {string}', (_c, text: string) => feed({ type: 'release', text }));
    Then('the line is sending', () => expect(line.phase).toBe('sending'));
    And('the turn to send is turn {number} of {string} saying {string} with no cut', (_c, n: number, id: string, text: string) => {
      expect(line.outgoing).toEqual(turnOf(id, Number(n), text));
    });
    When('the turn has been sent at {number}', (_c, at: number) => feed({ type: 'sent', at: Number(at) }));
    Then('the line is waiting', () => expect(line.phase).toBe('waiting'));
  });

  Scenario('AC-2: releasing with no words, or cancelling, goes back to idle', ({ Given, When, And, Then }) => {
    Given('the line is idle', () => {
      line = initialTalkLine;
    });
    When('he holds the button for talk {string}', (_c, id: string) => feed({ type: 'hold', talkId: id }));
    And('he releases with the words {string}', (_c, text: string) => feed({ type: 'release', text }));
    Then('the line is idle', () => expect(line.phase).toBe('idle'));
    When('he holds the button again for talk {string}', (_c, id: string) => feed({ type: 'hold', talkId: id }));
    And('he cancels', () => feed({ type: 'cancel' }));
    Then('the line is idle again', () => expect(line.phase).toBe('idle'));
    And('nothing is left to send', () => expect(line.outgoing).toBeUndefined());
  });

  Scenario('AC-2: an answer is spoken and the line goes back to idle', ({ Given, When, Then, And }) => {
    Given('the line is waiting on turn {number} of {string}', (_c, n: number, id: string) => waitingOn(id, Number(n)));
    When('the Mayor answers {string} on model {string}', (_c, text: string, model: string) => {
      feed({ type: 'incoming', turn: { talk: line.talk!, text, role: 'answer', model } });
    });
    Then('the line is speaking {string}', (_c, text: string) => {
      expect(line.phase).toBe('speaking');
      expect(line.speaking?.text).toBe(text);
    });
    And('the chip says {string} answered', (_c, model: string) => expect(line.answeredBy).toBe(model));
    When('the speaking ends', () => feed({ type: 'spoken' }));
    Then('the line is idle', () => expect(line.phase).toBe('idle'));
  });

  Scenario('AC-2: a holding answer is spoken, then the line waits for the real one', ({ Given, When, Then }) => {
    Given('the line is waiting on turn {number} of {string}', (_c, n: number, id: string) => waitingOn(id, Number(n)));
    When('the Mayor says holding {string}', (_c, text: string) => feed({ type: 'incoming', turn: { talk: line.talk!, text, role: 'holding' } }));
    Then('the line is speaking {string}', (_c, text: string) => {
      expect(line.phase).toBe('speaking');
      expect(line.speaking).toEqual({ text, holding: true });
    });
    When('the speaking ends', () => feed({ type: 'spoken' }));
    Then('the line is waiting', () => expect(line.phase).toBe('waiting'));
    When('the Mayor answers {string} on model {string}', (_c, text: string, model: string) => {
      feed({ type: 'incoming', turn: { talk: line.talk!, text, role: 'answer', model } });
    });
    Then('the line is now speaking {string}', (_c, text: string) => {
      expect(line.speaking).toEqual({ text, holding: false });
    });
  });

  Scenario('AC-2: the real answer cuts across a holding answer still being spoken', ({ Given, When, And, Then }) => {
    Given('the line is waiting on turn {number} of {string}', (_c, n: number, id: string) => waitingOn(id, Number(n)));
    When('the Mayor says holding {string}', (_c, text: string) => feed({ type: 'incoming', turn: { talk: line.talk!, text, role: 'holding' } }));
    And('the Mayor answers {string} on model {string}', (_c, text: string, model: string) => {
      feed({ type: 'incoming', turn: { talk: line.talk!, text, role: 'answer', model } });
    });
    Then('the line is speaking {string}', (_c, text: string) => expect(line.speaking).toEqual({ text, holding: false }));
  });

  Scenario('AC-2: a tap cuts the answer, and his next turn says so', ({ Given, When, And, Then }) => {
    Given('the line is speaking {string} for turn {number} of {string}', (_c, text: string, n: number, id: string) => speakingFor(id, Number(n), text));
    When('he cuts the answer', () => feed({ type: 'cut' }));
    Then('the line is idle', () => expect(line.phase).toBe('idle'));
    When('he holds the button for talk {string}', (_c, id: string) => feed({ type: 'hold', talkId: id }));
    And('he releases with the words {string}', (_c, text: string) => feed({ type: 'release', text }));
    Then('the turn to send is turn {number} of {string} saying {string} with a cut', (_c, n: number, id: string, text: string) => {
      expect(line.outgoing).toEqual(turnOf(id, Number(n), text, { cut: true }));
    });
  });

  Scenario('AC-2: holding the button over a spoken answer cuts it and listens', ({ Given, When, And, Then }) => {
    Given('the line is speaking {string} for turn {number} of {string}', (_c, text: string, n: number, id: string) => speakingFor(id, Number(n), text));
    When('he holds the button for talk {string}', (_c, id: string) => feed({ type: 'hold', talkId: id }));
    Then('the line is listening', () => expect(line.phase).toBe('listening'));
    When('he releases with the words {string}', (_c, text: string) => feed({ type: 'release', text }));
    Then('the turn to send is turn {number} of {string} saying {string} with a cut', (_c, n: number, id: string, text: string) => {
      expect(line.outgoing).toEqual(turnOf(id, Number(n), text, { cut: true }));
    });
    And('nothing else is said', () => expect(line.speaking).toBeUndefined());
  });

  const tick = (now: number) => feed({ type: 'tick', now: Number(now), here: mayorHere });
  const waitingWith = (n: number, id: string, since: number, here: boolean) => {
    mayorHere = here;
    waitingOn(id, Number(n), Number(since), here);
  };

  Scenario('AC-2: the Mayor is here: thinking at 8 s, give-up at 90 s (mw-j0f2d.30)', ({ Given, When, Then, And }) => {
    Given('the line is waiting on turn {number} of {string} since {number} and the Mayor is here', (_c, n: number, id: string, since: number) => waitingWith(n, id, since, true));
    Then('the line is not yet thinking', () => expect(line.thinking).toBeFalsy());
    When('the clock reads {number}', (_c, now: number) => tick(now));
    Then('the line is still not thinking', () => expect(line.thinking).toBeFalsy());
    When('the clock then reads {number}', (_c, now: number) => tick(now));
    Then('the line is thinking', () => expect(line.thinking).toBe(true));
    When('the clock afterwards reads {number}', (_c, now: number) => tick(now));
    Then('the line is still waiting', () => expect(line.phase).toBe('waiting'));
    When('the clock reads {number} again', (_c, now: number) => tick(now));
    Then('the line is waiting still', () => expect(line.phase).toBe('waiting'));
    When('the clock reads {number} once more', (_c, now: number) => tick(now));
    Then('the line is idle', () => expect(line.phase).toBe('idle'));
    And('the line says {string}', (_c, message: string) => expect(line.error).toBe(message));
  });

  Scenario('AC-2: the Mayor is away: give-up at 30 s (mw-j0f2d.30)', ({ Given, When, Then, And }) => {
    Given('the line is waiting on turn {number} of {string} since {number} and the Mayor is away', (_c, n: number, id: string, since: number) => waitingWith(n, id, since, false));
    When('the clock reads {number}', (_c, now: number) => tick(now));
    Then('the line is still waiting', () => expect(line.phase).toBe('waiting'));
    And('the line is not yet thinking', () => expect(line.thinking).toBeFalsy());
    When('the clock then reads {number}', (_c, now: number) => tick(now));
    Then('the line is waiting still', () => expect(line.phase).toBe('waiting'));
    When('the clock afterwards reads {number}', (_c, now: number) => tick(now));
    Then('the line is idle', () => expect(line.phase).toBe('idle'));
    And('the line says {string}', (_c, message: string) => expect(line.error).toBe(message));
  });

  Scenario('AC-2: the Mayor seen here while he thinks keeps the longer wait even when his wait drops (mw-j0f2d.30)', ({ Given, When, Then, And }) => {
    Given('the line is waiting on turn {number} of {string} since {number} and the Mayor is here', (_c, n: number, id: string, since: number) => waitingWith(n, id, since, true));
    When('the clock reads {number}', (_c, now: number) => tick(now));
    Then('the line is thinking', () => expect(line.thinking).toBe(true));
    When('the Mayor\'s wait drops and the clock then reads {number}', (_c, now: number) => {
      mayorHere = false;
      tick(now);
    });
    Then('the line is still waiting', () => expect(line.phase).toBe('waiting'));
    And('the line is thinking', () => expect(line.thinking).toBe(true));
  });

  Scenario('AC-2: a late answer replaces the give-up line (mw-j0f2d.30)', ({ Given, When, Then, And }) => {
    Given('the line is waiting on turn {number} of {string} since {number} and the Mayor is away', (_c, n: number, id: string, since: number) => waitingWith(n, id, since, false));
    When('the clock reads {number}', (_c, now: number) => tick(now));
    Then('the line says {string}', (_c, message: string) => expect(line.error).toBe(message));
    When('the Mayor answers {string} on model {string}', (_c, text: string, model: string) => {
      feed({ type: 'incoming', turn: { talk: line.talk!, text, role: 'answer', model } });
    });
    Then('the line is speaking {string}', (_c, text: string) => {
      expect(line.phase).toBe('speaking');
      expect(line.speaking?.text).toBe(text);
    });
    And('the line says nothing went wrong', () => expect(line.error).toBeUndefined());
  });

  Scenario('AC-2: an answer while hidden is announced, not spoken (mw-j0f2d.29)', ({ Given, When, Then, And }) => {
    Given('the line is waiting on turn {number} of {string}', (_c, n: number, id: string) => waitingOn(id, Number(n)));
    When('the Mayor answers {string} while he is away from the app', (_c, text: string) => {
      feed({ type: 'incoming', turn: { talk: line.talk!, text, role: 'answer' }, hidden: true });
    });
    Then('the line is holding {string} unspoken', (_c, text: string) => {
      expect(line.phase).toBe('speaking');
      expect(line.speaking).toEqual({ text, holding: false, unspoken: true });
    });
    And('the announcement says {string} with a buzz and none of the answer\'s words', (_c, title: string) => {
      const spec = notificationSpecForTalkAnswer();
      expect(spec.title).toBe(title);
      expect(spec.options.vibrate?.length).toBeGreaterThan(0);
      expect(spec.options.silent).toBe(false);
      expect(JSON.stringify(spec)).not.toContain('Three things landed');
      expect(spec.options.body).toBeUndefined();
    });
  });

  Scenario('AC-2: the unspoken answer speaks on return (mw-j0f2d.29)', ({ Given, And, When, Then }) => {
    Given('the line is waiting on turn {number} of {string}', (_c, n: number, id: string) => waitingOn(id, Number(n)));
    And('the Mayor answers {string} while he is away from the app', (_c, text: string) => {
      feed({ type: 'incoming', turn: { talk: line.talk!, text, role: 'answer' }, hidden: true });
    });
    When('he comes back to the app', () => feed({ type: 'visible' }));
    Then('the line is speaking {string} and it is no longer unspoken', (_c, text: string) => {
      expect(line.phase).toBe('speaking');
      expect(line.speaking?.text).toBe(text);
      expect(line.speaking?.unspoken).toBeUndefined();
    });
    When('the speaking ends', () => feed({ type: 'spoken' }));
    Then('the line is idle', () => expect(line.phase).toBe('idle'));
  });

  Scenario('AC-2: a holding answer while hidden is not queued to speak later (mw-j0f2d.29)', ({ Given, When, Then }) => {
    Given('the line is waiting on turn {number} of {string}', (_c, n: number, id: string) => waitingOn(id, Number(n)));
    When('the Mayor says holding {string} while he is away from the app', (_c, text: string) => {
      feed({ type: 'incoming', turn: { talk: line.talk!, text, role: 'holding' }, hidden: true });
    });
    Then('the line is waiting', () => expect(line.phase).toBe('waiting'));
  });

  Scenario('AC-2: an answer to another talk or turn is ignored', ({ Given, When, And, Then }) => {
    Given('the line is waiting on turn {number} of {string}', (_c, n: number, id: string) => waitingOn(id, Number(n)));
    When('the Mayor answers {string} for turn {number} of {string}', (_c, text: string, n: number, id: string) => {
      feed({ type: 'incoming', turn: { talk: { id, turn: Number(n) }, text, role: 'answer' } });
    });
    And('the Mayor answers {string} for turn {number} of {string} too', (_c, text: string, n: number, id: string) => {
      feed({ type: 'incoming', turn: { talk: { id, turn: Number(n) }, text, role: 'answer' } });
    });
    Then('the line is waiting', () => expect(line.phase).toBe('waiting'));
  });

  Scenario('AC-2: a failed send goes back to idle and gives the turn number back', ({ Given, When, And, Then }) => {
    Given('the line is idle', () => {
      line = initialTalkLine;
    });
    When('he holds the button for talk {string}', (_c, id: string) => feed({ type: 'hold', talkId: id }));
    And('he releases with the words {string}', (_c, text: string) => feed({ type: 'release', text }));
    And('the send fails', () => feed({ type: 'sendFailed' }));
    Then('the line is idle', () => expect(line.phase).toBe('idle'));
    And('the line says {string}', (_c, message: string) => expect(line.error).toBe(message));
    When('he holds the button again for talk {string}', (_c, id: string) => feed({ type: 'hold', talkId: id }));
    And('he then releases with the words {string}', (_c, text: string) => feed({ type: 'release', text }));
    Then('the turn to send is turn {number} of {string} saying {string} with no cut', (_c, n: number, id: string, text: string) => {
      expect(line.outgoing).toEqual(turnOf(id, Number(n), text));
    });
  });

  Scenario('AC-1: a failed send keeps his words and Try again resends them as the same turn', ({ Given, When, And, Then }) => {
    Given('the line is idle', () => {
      line = initialTalkLine;
    });
    When('he holds the button for talk {string}', (_c, id: string) => feed({ type: 'hold', talkId: id }));
    And('he releases with the words {string}', (_c, text: string) => feed({ type: 'release', text }));
    And('the send fails', () => feed({ type: 'sendFailed' }));
    Then('the line is idle', () => expect(line.phase).toBe('idle'));
    And('the line says {string}', (_c, message: string) => expect(line.error).toBe(message));
    And('the line still holds the unsent words {string}', (_c, text: string) => expect(line.unsent?.text).toBe(text));
    When('he asks to try again', () => feed({ type: 'retry' }));
    Then('the turn to send is turn {number} of {string} saying {string} with no cut', (_c, n: number, id: string, text: string) => {
      expect(line.outgoing).toEqual(turnOf(id, Number(n), text));
    });
    When('the send goes through', () => feed({ type: 'sent', at: 1000 }));
    Then('the line is waiting', () => expect(line.phase).toBe('waiting'));
    And('the line holds no unsent words', () => expect(line.unsent).toBeUndefined());
  });

  Scenario('AC-1: a turn longer than the cap is cut with "..." and still sent', ({ Given, When, And, Then }) => {
    Given('the line is idle', () => {
      line = initialTalkLine;
    });
    When('he holds the button for talk {string}', (_c, id: string) => feed({ type: 'hold', talkId: id }));
    And('he releases with {number} words', (_c, n: number) => feed({ type: 'release', text: Array.from({ length: Number(n) }, (_, i) => `word${i % 97}`).join(' ') }));
    Then('the line is sending', () => expect(line.phase).toBe('sending'));
    And('the turn to send ends with {string} and is within the cap', (_c, tail: string) => {
      const text = line.outgoing?.text ?? '';
      expect(text.endsWith(tail)).toBe(true);
      expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(TURN_TEXT_MAX_BYTES);
    });
  });

  const mayorKnownBackendDown = () => {
    down = backendDownWoc();
    delivered = undefined;
    failure = undefined;
  };
  const chainOptions = (extra: { offline?: boolean } = {}) => ({
    key: HIM_KEY,
    mayorKey: MAYOR.toPublicKey().toString(),
    direct: true,
    fetchImpl: down.fetchImpl,
    ...extra,
  });
  const broadcastTx = () => Transaction.fromHex(down.broadcasts[0]);

  Scenario('AC-3: Call me while the backend is unreachable goes on chain (mw-a0ih0.4)', ({ Given, When, Then, And }) => {
    Given("the Mayor's key is known, the backend cannot be reached and WhatsOnChain lists one coin", mayorKnownBackendDown);
    When('he delivers a call request saying {string} at {number}', async (_c, text: string, at: number) => {
      delivered = await deliverCallRequest(text, Number(at), chainOptions());
      await settledWrites();
    });
    Then('the request went on chain', () => {
      expect(delivered?.channel).toBe('chain');
      expect(delivered?.txid).toMatch(/^[0-9a-f]{64}$/);
    });
    And('WhatsOnChain was sent one section 4 transaction with the record, the anchor payment and change', () => {
      expect(down.broadcasts).toHaveLength(1);
      const tx = broadcastTx();
      expect(tx.outputs).toHaveLength(3);
      expect(tx.outputs[0].satoshis).toBe(0);
      expect(decodeRecordScript(tx.outputs[0].lockingScript)).not.toBeNull();
      expect(tx.outputs[1].satoshis).toBe(1);
      expect(tx.outputs[1].lockingScript.toHex()).toBe(new P2PKH().lock(ANCHOR_ADDRESS).toHex());
      expect(tx.outputs[2].lockingScript.toHex()).toBe(new P2PKH().lock(PrivateKey.fromHex('45'.repeat(32)).toAddress('testnet')).toHex());
      expect(tx.id('hex')).toBe(delivered?.txid);
    });
    And('the Mayor reads that record as a request saying {string} at {number}', (_c, text: string, at: number) => {
      const script = decodeRecordScript(broadcastTx().outputs[0].lockingScript);
      const payload = JSON.parse(Utils.toUTF8(Array.from(script!.payloadBytes))) as MessagePayload;
      expect(payload.class).toBe('call');
      expect(decodeCall(decryptMessage(payload, MAYOR.toHex()))).toEqual({ role: 'request', text, at: Number(at) });
    });
    And('this phone keeps its sent copy under the chain id', async () => {
      const kept = await db.messages.get(`${delivered?.txid}:0`);
      expect(kept?.direction).toBe('sent');
      expect(kept?.class).toBe('call');
    });
  });

  Scenario('AC-3: a message does not fall back to chain on a network error (mw-a0ih0.4)', ({ Given, When, Then }) => {
    Given("the Mayor's key is known, the backend cannot be reached and WhatsOnChain lists one coin", mayorKnownBackendDown);
    When('he tries to deliver a message saying {string}', async (_c, text: string) => {
      failure = await deliver(text, 'message', chainOptions()).then(() => undefined, (err: unknown) => err ?? new Error('failed'));
    });
    Then('the delivery fails and WhatsOnChain was never asked', () => {
      expect(failure).toBeInstanceOf(TypeError);
      expect(down.wocCalls).toEqual([]);
      expect(down.broadcasts).toEqual([]);
    });
  });

  Scenario('AC-3: a Call me while the phone knows it is offline goes on chain without trying the backend (mw-a0ih0.4)', ({ Given, When, Then, And }) => {
    Given("the Mayor's key is known, the backend cannot be reached and WhatsOnChain lists one coin", mayorKnownBackendDown);
    When('he delivers a call request saying {string} at {number} while the phone is offline', async (_c, text: string, at: number) => {
      delivered = await deliverCallRequest(text, Number(at), chainOptions({ offline: true }));
      await settledWrites();
    });
    Then('the request went on chain', () => expect(delivered?.channel).toBe('chain'));
    And('the backend was never tried', () => expect(down.apiCalls).toEqual([]));
  });

  Scenario('AC-2: the model is chosen per talk and rides on his turns', ({ Given, When, And, Then }) => {
    Given('the line is idle', () => {
      line = initialTalkLine;
    });
    When('he picks the model {string}', (_c, model: string) => feed({ type: 'setModel', model }));
    And('he holds the button for talk {string}', (_c, id: string) => feed({ type: 'hold', talkId: id }));
    And('he releases with the words {string}', (_c, text: string) => feed({ type: 'release', text }));
    Then('the turn to send is turn {number} of {string} saying {string} on model {string}', (_c, n: number, id: string, text: string, model: string) => {
      expect(line.outgoing).toEqual(turnOf(id, Number(n), text, { model }));
    });
    When('the talk ends', () => feed({ type: 'end' }));
    Then('the line is idle', () => expect(line.phase).toBe('idle'));
    And('the line has no model', () => expect(line.model).toBeUndefined());
  });

  Scenario('AC-2: the Mayor ending the talk ends it for both', ({ Given, When, Then, And }) => {
    Given('the line is waiting on turn {number} of {string}', (_c, n: number, id: string) => waitingOn(id, Number(n)));
    When('the Mayor ends the talk', () => feed({ type: 'incoming', turn: { talk: line.talk!, text: '', role: 'end' } }));
    Then('the line is idle', () => expect(line.phase).toBe('idle'));
    And('the line has no talk', () => expect(line.talk).toBeUndefined());
  });

  Scenario('AC-3: a talk record is absent from channel lists, unread counts and Needs', ({ Given, When, Then, And }) => {
    Given('a stored channel message {string} and a stored talk record {string}', async (_c, real: string, spoken: number) => {
      stored = [row('ab'.repeat(32), real, 'message'), row('cd'.repeat(32), spoken, 'talk')];
      for (const r of stored) await db.messages.put(r);
    });
    When('Talk opens and the badges are read', async () => {
      window.history.replaceState(null, '', '/?v=talk');
      render(
        <Shell route={{ view: 'talk' }}>
          <TalkScreen />
        </Shell>,
      );
      await screen.findByTestId('thread-list');
    });
    Then('the channel list shows {string} and never {string}', async (_c, real: string, spoken: number) => {
      const list = await screen.findByTestId('thread-list');
      await waitFor(() => expect(within(list).getByText(real)).toBeInTheDocument());
      expect(within(list).queryByText(spoken)).toBeNull();
    });
    And('the unread count is {number}', async (_c, count: number) => {
      const places = screen.getAllByRole('navigation', { name: 'Places' })[0];
      await waitFor(() => expect(within(places).getByRole('link', { name: /Channels$/ }).textContent).toBe(`${count}Channels`));
    });
    And('Needs has no entry for the talk record', async () => {
      cleanup();
      render(<NeedsScreen />);
      const unread = await screen.findByRole('region', { name: 'Unread from the Mayor' });
      expect(within(unread).getByText('Real message')).toBeInTheDocument();
      expect(screen.queryByText('Spoken words')).toBeNull();
    });
  });
});
