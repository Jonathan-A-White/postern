// features/steps/unsettled-needs-names-card.steps.ts — runs features/unsettled-needs-names-card.feature (mw-gq6.735):
// the needs still waiting on him are the cards no answer names, an answer naming no card keeping the bead-and-time rule.
import { expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import type { AnswerRow, MessageRow } from '../../src/data/db';
import { unsettledNeeds } from '../../src/model/needs';
import type { Need } from '../../src/model/view';
import { encodeQuestion } from '../../src/services/questions';

const BEAD = 'mw-6ww.119';
const FIRST = `direct:${'a'.repeat(64)}`;
const SECOND = `direct:${'b'.repeat(64)}`;
const at = (hhmm: string) => Date.parse(`2026-10-15T${hhmm}:00Z`) / 1000;

function card(txid: string, hhmm: string, options: string[]): { need: Need; post: MessageRow } {
  const ts = at(hhmm);
  return {
    need: { kind: 'question', bead: BEAD, epic: '', title: 'Digest', since: new Date(ts * 1000).toISOString(), text: 'Which?', recommended: '', options, blocks: 0, steps: [] },
    post: { id: `${txid}:0`, txid, vout: 0, seq: ts, class: 'decision-needed', to: 't', from: 'f', ts, ciphertext: '', plaintext: encodeQuestion({ bead: BEAD, q: 'Which?', rec: '', options }), direction: 'received', read: true },
  };
}

let first: ReturnType<typeof card>;
let second: ReturnType<typeof card>;
let answers: AnswerRow[] = [];
let listed: Need[] = [];

const feature = await loadFeature('features/unsettled-needs-names-card.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(() => {
    answers = [];
    listed = [];
  });

  const twoCards = (Given: (text: string, fn: () => void) => void) =>
    Given('two question cards on one bead, the second asked after the first', () => {
      first = card(FIRST, '10:05', ['Weekly', 'Per demo']);
      second = card(SECOND, '12:07', ['Rebase', 'Merge']);
    });
  const list = (When: (text: string, fn: () => void) => void) =>
    When('the needs still waiting on him are listed', () => {
      listed = unsettledNeeds([first.need, second.need], answers, [first.post, second.post]);
    });
  const onlySecond = (Then: (text: string, fn: () => void) => void) =>
    Then('only the second card is listed', () => {
      expect(listed).toEqual([second.need]);
    });

  Scenario('mw-gq6.735: an answer naming the first of two cards on a bead leaves the second card waiting', ({ Given, And, When, Then }) => {
    twoCards(Given);
    And('an answer sent after both that names the first card', () => {
      answers = [{ bead: BEAD, answer: 'Weekly', txid: 'direct:cc', ts: at('12:08'), re: FIRST }];
    });
    list(When);
    onlySecond(Then);
  });

  Scenario('mw-gq6.735: an answer naming no card settles the cards asked before it, as before', ({ Given, And, When, Then }) => {
    twoCards(Given);
    And('an answer sent between the two that names no card', () => {
      answers = [{ bead: BEAD, answer: 'Weekly', txid: 'direct:cc', ts: at('11:00') }];
    });
    list(When);
    onlySecond(Then);
  });
});
