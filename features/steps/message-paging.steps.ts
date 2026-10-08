// features/steps/message-paging.steps.ts — runs features/message-paging.feature (mw-xhtcup.4):
// the real message sync and the real Dexie store; only the backend is a double.
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey, Utils } from '@bsv/sdk';
import { db } from '../../src/data/db';
import { messagesRepo, settingsRepo } from '../../src/data/repositories';
import { encryptMessage } from '../../src/services/messages';
import { syncMessages } from '../../src/services/inbox';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

const ME = PrivateKey.fromHex('44'.repeat(32));
const MAYOR = PrivateKey.fromHex('55'.repeat(32));
const ME_PUB = ME.toPublicKey().toString();
const KEY = new Uint8Array(Utils.toArray(ME.toHex(), 'hex'));

function record(seq: number, text: string) {
  const payload = encryptMessage({ text, class: 'message', senderPrivateKeyHex: MAYOR.toHex(), recipientPublicKeyHex: ME_PUB });
  return { seq, txid: seq.toString(16).padStart(64, '0'), vout: 0, payload };
}

function page(records: unknown[], next: number, more?: boolean): Response {
  return new Response(JSON.stringify(more === undefined ? { records, next } : { records, next, more }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

let asked: string[] = [];
let cursorsSeen: unknown[] = [];
let secondPageFails = false;
let pages = new Map<number, () => Response>();

async function backend(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (isChallengeRequest(url)) return challengeResponse();
  asked.push(url);
  cursorsSeen.push(await settingsRepo.get('messages-cursor'));
  const since = Number(new URL(url, 'http://x').searchParams.get('since'));
  return pages.get(since)?.() ?? page([], since, false);
}

const sync = () => syncMessages({ publicKeyHex: ME_PUB, unlockedKey: KEY, fetchImpl: backend });
const texts = async () => (await messagesRepo.getAll()).map((row) => row.plaintext).sort();

async function fresh(): Promise<void> {
  asked = [];
  cursorsSeen = [];
  secondPageFails = false;
  pages = new Map();
  await Promise.all([db.settings.clear(), db.messages.clear()]);
}

afterAll(fresh);

const feature = await loadFeature('features/message-paging.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  Scenario('mw-xhtcup.4 AC-1: a server answering three pages is drained in one sync, the cursor stored after each page', ({ Given, When, Then, And }) => {
    Given('a backend that holds five messages in three pages', () => {
      pages.set(0, () => page([record(1, 'one'), record(2, 'two')], 2, true));
      pages.set(2, () => page([record(3, 'three'), record(4, 'four')], 4, true));
      pages.set(4, () => page([record(5, 'five')], 5, false));
    });
    When('the phone syncs its messages once', async () => {
      await sync();
    });
    Then('it asked for each page with limit 200 and the cursor stored so far', () => {
      expect(asked).toEqual(['/api/messages?since=0&limit=200', '/api/messages?since=2&limit=200', '/api/messages?since=4&limit=200']);
      expect(cursorsSeen).toEqual([undefined, 2, 4]);
    });
    And('all five messages are stored once and the cursor is at the end', async () => {
      expect(await texts()).toEqual(['five', 'four', 'one', 'three', 'two']);
      expect(await settingsRepo.get('messages-cursor')).toBe(5);
    });
  });

  Scenario('mw-xhtcup.4 AC-2: a failure on the second page keeps the cursor at the first page and the next sync resumes there', ({ Given, When, Then }) => {
    Given('a backend whose second page fails once', () => {
      secondPageFails = true;
      pages.set(0, () => page([record(1, 'one')], 1, true));
      pages.set(1, () => (secondPageFails ? new Response('boom', { status: 500 }) : page([record(2, 'two')], 2, false)));
    });
    When('the phone syncs its messages and the second page fails', async () => {
      await expect(sync()).rejects.toThrow('Could not fetch messages (500).');
    });
    Then("the first page's message is stored and the cursor is at the first page's end", async () => {
      expect(await texts()).toEqual(['one']);
      expect(await settingsRepo.get('messages-cursor')).toBe(1);
      secondPageFails = false;
    });
    When('the phone syncs its messages again', async () => {
      asked = [];
      await sync();
    });
    Then("the sync resumes from the first page's end and all messages are stored once", async () => {
      expect(asked).toEqual(['/api/messages?since=1&limit=200']);
      expect(await texts()).toEqual(['one', 'two']);
      expect(await settingsRepo.get('messages-cursor')).toBe(2);
    });
  });

  Scenario('mw-xhtcup.4 AC-3: an older backend that answers without more is read as one page', ({ Given, When, Then }) => {
    Given('an older backend that answers one page without more', () => {
      pages.set(0, () => page([record(1, 'one')], 1));
    });
    When('the phone syncs its messages once', async () => {
      await sync();
    });
    Then('only one page was asked for and the cursor is at its end', async () => {
      expect(asked).toEqual(['/api/messages?since=0&limit=200']);
      expect(await settingsRepo.get('messages-cursor')).toBe(1);
    });
  });
});
