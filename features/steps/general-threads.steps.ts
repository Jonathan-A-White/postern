// features/steps/general-threads.steps.ts — runs features/general-threads.feature
// under vitest via @amiceli/vitest-cucumber (mw-hkg17.1).
import { expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { mergeConversation } from '../../src/model/conversation';
import { groupGeneral, type GeneralThread } from '../../src/model/generalThreads';
import { encodeThreadedMessage } from '../../src/services/threads';
import type { MessageRow } from '../../src/data/db';

const feature = await loadFeature('features/general-threads.feature');

function makeRow(seq: number, plaintext: string): MessageRow {
  const txid = `direct:${String(seq).padStart(64, '0')}`;
  return { id: `${txid}:0`, txid, vout: 0, seq, class: 'message', to: 't', from: 'f', ts: 1_760_000_000 + seq * 60, ciphertext: '', plaintext, direction: 'received', read: false };
}

describeFeature(feature, ({ Scenario }) => {
  Scenario('mw-hkg17.1: a General message whose re names another General message is a reply in that message\'s thread', ({ Given, And, When, Then }) => {
    const rows: MessageRow[] = [];
    const byText = new Map<string, MessageRow>();
    let threads: GeneralThread[] = [];
    const add = (text: string, reName?: string) => {
      const re = reName === undefined ? undefined : byText.get(reName)?.txid;
      const made = makeRow(rows.length + 1, re === undefined ? text : JSON.stringify({ text, re }));
      rows.push(made);
      byText.set(text, made);
    };

    Given('a General message {string}', (_ctx, text: string) => add(text));
    And('a General message {string} whose re names {string}', (_ctx, text: string, target: string) => add(text, target));
    And('a General message {string} whose re names the reply {string}', (_ctx, text: string, target: string) => add(text, target));
    And('a General message {string}', (_ctx, text: string) => add(text));
    When('General is grouped into threads', () => {
      threads = groupGeneral(mergeConversation(rows));
    });
    Then('the threads are rooted at {string} and {string} in that order', (_ctx, first: string, second: string) => {
      expect(threads.map((thread) => thread.root.text)).toEqual([first, second]);
    });
    And('{string} has the replies {string} and {string}', (_ctx, root: string, first: string, second: string) => {
      const thread = threads.find((candidate) => candidate.root.text === root);
      expect(thread?.replies.map((reply) => reply.text)).toEqual([first, second]);
    });
    And('{string} has no replies', (_ctx, text: string) => {
      expect(threads.find((candidate) => candidate.root.text === text)?.replyCount).toBe(0);
    });
  });

  Scenario('mw-hkg17.1: a transcript or an unknown re is not a reply', ({ Given, And, When, Then }) => {
    const rows: MessageRow[] = [];
    let threads: GeneralThread[] = [];

    Given('a voice note in General', () => {
      rows.push(makeRow(1, encodeThreadedMessage({ text: '', attachment: { hash: 'h', size: 9, mime: 'audio/webm' } })));
    });
    And('a transcript whose re names the voice note', () => {
      rows.push(makeRow(2, JSON.stringify({ text: 'what was heard', re: rows[0].txid, role: 'transcript' })));
    });
    And('a General message {string} whose re names a message that is not there', (_ctx, text: string) => {
      rows.push(makeRow(3, JSON.stringify({ text, re: `direct:${'e'.repeat(64)}` })));
    });
    When('General is grouped into threads', () => {
      threads = groupGeneral(mergeConversation(rows));
    });
    Then('the voice note has no replies', () => {
      expect(threads[0].root.kind).toBe('attachment');
      expect(threads[0].replyCount).toBe(0);
    });
    And('{string} is a thread root with no replies', (_ctx, text: string) => {
      const lost = threads.find((thread) => thread.root.text === text);
      expect(lost?.replyCount).toBe(0);
    });
  });
});
