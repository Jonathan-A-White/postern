// features/steps/voice-transcript.steps.tsx — runs features/voice-transcript.feature
// (mw-q6n8m0.4): a voice note in General against a seeded Dexie, with the Mayor's host's
// transcript record (docs/protocol.md §14) arriving as a row beside it. jsdom has no
// layout, so the clamp's measurements are stood in for through the prototype.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { db, type MessageRow } from '../../src/data/db';
import { messagesRepo, viewRepo } from '../../src/data/repositories';
import { lock, setKey } from '../../src/services/keySession';
import { fixtureView } from '../../tests/support/cockpit-fixture';

configure({ asyncUtilTimeout: 5000 });

vi.mock('../../src/services/blobs', () => ({ openAttachment: async () => 'blob:audio' }));

const BASE = 1_760_000_000;
const LONG = 'So I think you are switching to the push to talk, like we are doing things here, and so this might be a moot issue, but I cannot see this happens to anyone. I can hear it, I can play it, but I cannot see it.';
let note: MessageRow | undefined;

function row(sequence: number, plaintext: string, direction: 'sent' | 'received'): MessageRow {
  const txid = `direct:${String(sequence).padStart(64, '0')}`;
  return { id: `${txid}:0`, txid, vout: 0, seq: sequence, class: 'message', to: '02'.padEnd(66, '0'), from: '03'.padEnd(66, '0'), ts: BASE + sequence * 60, ciphertext: '', plaintext, direction, read: true };
}

async function seedNote(): Promise<MessageRow> {
  note = row(1, JSON.stringify({ text: '', attachment: { hash: 'ab'.repeat(32), size: 4000, mime: 'audio/webm' } }), 'sent');
  await messagesRepo.put(note);
  return note;
}

const transcriptRow = (text: string): MessageRow => row(2, JSON.stringify({ text, re: note!.txid, role: 'transcript' }), 'received');

// The clamp is two lines of 18 px: a paragraph of more than 120 characters runs to four.
let layout: { restore: () => void } | undefined;
function standInForLayout(): void {
  const client = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
  const linesOf = (el: HTMLElement) => Math.ceil((el.textContent ?? '').length / 60);
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.dataset.testid !== 'transcript-text') return 0;
      return 18 * Math.min(this.classList.contains('line-clamp-2') ? 2 : 99, linesOf(this));
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.testid === 'transcript-text' ? 18 * linesOf(this) : 0;
    },
  });
  layout = {
    restore() {
      if (client) Object.defineProperty(HTMLElement.prototype, 'clientHeight', client);
      if (scroll) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scroll);
    },
  };
}

async function fresh(): Promise<void> {
  cleanup();
  note = undefined;
  await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear()]);
  window.history.replaceState(null, '', '/?v=talk');
  standInForLayout();
  setKey(new Uint8Array(32).fill(7));
}

async function openGeneral(): Promise<void> {
  cleanup();
  window.history.replaceState(null, '', '/?v=talk&t=general');
  const now = Date.now();
  await viewRepo.save({ plaintext: JSON.stringify(fixtureView(now)), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
  render(<TalkScreen thread="general" />);
  await screen.findByTestId('conversation');
}

const bubble = () => within(screen.getByTestId('conversation')).getAllByTestId('message')[0];
const words = () => within(bubble()).queryByTestId('transcript-text');
const moreButton = () => within(bubble()).queryByRole('button', { name: 'more' });

const showsWords = async (_ctx: unknown, text: string) => {
  await waitFor(() => expect(words()).toHaveTextContent(text));
  expect(await within(bubble()).findByTestId('voice-player')).toBeInTheDocument();
};

afterAll(() => {
  layout?.restore();
  lock();
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/voice-transcript.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
  BeforeEachScenario(fresh);
  AfterEachScenario(() => layout?.restore());

  Scenario('AC-1: a transcribed note shows its words', ({ Given, When, Then, And }) => {
    Given("a voice note in General that the Mayor's host has transcribed as {string}", async (_ctx, text: string) => {
      await seedNote();
      await messagesRepo.put(transcriptRow(text));
    });
    When('General opens', openGeneral);
    Then('the voice note shows the words {string} under its player', showsWords);
    And('no "more" is offered', () => {
      expect(moreButton()).not.toBeInTheDocument();
    });
  });

  Scenario('AC-2: a long transcript is two lines with more, and more opens it all', ({ Given, When, Then, And }) => {
    Given("a voice note in General that the Mayor's host has transcribed as a long paragraph", async () => {
      await seedNote();
      await messagesRepo.put(transcriptRow(LONG));
    });
    When('General opens', openGeneral);
    Then('the transcript is held to two lines', async () => {
      await waitFor(() => expect(moreButton()).toBeInTheDocument());
      expect(words()).toHaveClass('line-clamp-2');
    });
    When('he taps more', async () => {
      await userEvent.click(moreButton()!);
    });
    Then('the whole transcript is shown', () => {
      expect(words()).not.toHaveClass('line-clamp-2');
      expect(words()).toHaveTextContent(LONG);
    });
    And('he can tap less to fold it again', async () => {
      await userEvent.click(within(bubble()).getByRole('button', { name: 'less' }));
      expect(words()).toHaveClass('line-clamp-2');
      expect(moreButton()).toBeInTheDocument();
    });
  });

  Scenario('AC-3: a note with no transcript yet is the player alone', ({ Given, When, Then }) => {
    Given('a voice note in General with no transcript yet', seedNote);
    When('General opens', openGeneral);
    Then('the voice note shows no words and no "more"', async () => {
      expect(await within(bubble()).findByTestId('voice-player')).toBeInTheDocument();
      expect(words()).not.toBeInTheDocument();
      expect(moreButton()).not.toBeInTheDocument();
    });
  });

  Scenario('AC-4: a note already sent gets its words when the transcript arrives', ({ Given, When, Then, And }) => {
    Given('a voice note in General with no transcript yet', seedNote);
    When('General opens', openGeneral);
    And("the Mayor's host sends the transcript {string}", async (_ctx, text: string) => {
      await messagesRepo.put(transcriptRow(text));
    });
    Then('the voice note shows the words {string} under its player', showsWords);
  });
});
