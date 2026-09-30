// features/steps/step-run-once.steps.tsx — runs features/step-run-once.feature (mw-t64a3.23).
import '@testing-library/react/dont-cleanup-after-each';
import { render, cleanup } from '@testing-library/react';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Conversation } from '../../src/cockpit/Conversation';
import { mergeConversation, type ConversationItem } from '../../src/model/conversation';
import { encodeThreadedMessage } from '../../src/services/threads';
import type { MessageRow } from '../../src/data/db';

const APPROVAL = 'bd1dcf8a19231b8dc20efa4e0a0c14a07c5c2cc9cacb58b0c469735c14a07b66';
const RUN = `RAN step backend-x on laptop as user, exit 0 (approved by the Governor via postern, txid direct:${APPROVAL})\n\n\`\`\`\nok\n\`\`\``;

function runMessage(text: string): MessageRow {
  const txid = `direct:${'ab'.repeat(32)}`;
  return {
    id: `${txid}:0`,
    txid,
    vout: 0,
    seq: 1,
    class: 'message',
    to: 't',
    from: 'f',
    ts: 1_760_000_400,
    ciphertext: '',
    plaintext: encodeThreadedMessage({ thread: { bead: 'b' }, text, re: `direct:${APPROVAL}` }),
    direction: 'received',
    read: true,
  };
}

let items: ConversationItem[] = [];
let thread: ConversationItem[] = [];
let container: HTMLElement;

afterAll(() => cleanup());

const feature = await loadFeature('features/step-run-once.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('mw-t64a3.23 AC1: a run said by a bead comment and by a message shows once, as the Mayor\'s message', ({ Given, When, Then }) => {
    Given("a hands step's run is recorded as a bead comment and sent as a message re his approval", () => {
      thread = [];
    });
    When("the bead's thread is read", () => {
      items = mergeConversation([runMessage(RUN)], [{ at: new Date(1_760_000_399_000).toISOString(), author: 'mw@laptop', text: RUN }]);
    });
    Then('the thread holds one card, from the Mayor', () => {
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ speaker: 'mayor', source: 'message' });
    });
  });

  Scenario('mw-t64a3.23 AC4: a long output line in a thread message wraps instead of scrolling', ({ Given, When, Then }) => {
    Given('a thread message whose output block holds a 120-character line', () => {
      thread = mergeConversation([runMessage(`\`\`\`\n${'x'.repeat(120)}\n\`\`\``)], []);
    });
    When('the thread is shown', () => {
      ({ container } = render(<Conversation items={thread} />));
    });
    Then("the message's Markdown is set to wrap its code", () => {
      expect(container.querySelector('.markdown')).toHaveClass('markdown-wrap');
    });
  });
});
