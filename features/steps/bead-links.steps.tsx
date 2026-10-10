// features/steps/bead-links.steps.tsx — runs features/bead-links.feature (mw-tbx1n.11):
// the Talk screen over a seeded Dexie, one message whose text names beads.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, configure, fireEvent } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { stop as stopSpeaking } from '../../src/services/speech';
import { db, type MessageRow } from '../../src/data/db';
import { messagesRepo, viewRepo } from '../../src/data/repositories';
import { fixtureView } from '../../tests/support/cockpit-fixture';
import { installHonestSpeech, type HonestSpeech } from '../../tests/support/honest-speech';

configure({ asyncUtilTimeout: 5000 });

let now = Date.now();
let seeded: MessageRow[] = [];
// The phone's voice is bsv-kit's honest speech synthesiser (mw-it6qk5.4).
let speech: HonestSpeech | null = null;
const spoken = (): string[] => speech?.log.map((entry) => entry.text) ?? [];
let extraBeads: Array<{ id: string; title: string }> = [];

function viewWith(at: number) {
  const view = fixtureView(at);
  const template = view.beads[0];
  for (const { id, title } of extraBeads) view.beads.push({ ...template, id, title, parent: '', waits: [] });
  return view;
}

function generalMessage(text: string): MessageRow {
  return {
    id: `${'ef'.repeat(32)}:0`,
    txid: 'ef'.repeat(32),
    vout: 0,
    seq: 1,
    class: 'message',
    to: '02'.padEnd(66, '0'),
    from: '03'.padEnd(66, '0'),
    ts: Math.floor(now / 1000),
    ciphertext: '',
    plaintext: text,
    direction: 'received',
    read: true,
  };
}

afterAll(() => {
  cleanup();
  stopSpeaking();
  speech?.uninstall();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/bead-links.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    now = Date.now();
    seeded = [];
    speech?.uninstall();
    extraBeads = [];
    speech = installHonestSpeech();
    stopSpeaking(); // a message left 'speaking' by the last scenario would read Stop reading
    await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear()]);
    window.history.replaceState(null, '', '/?v=talk&t=general');
  });

  Scenario("mw-tbx1n.11: a bead id in a Talk message is a link to that bead's page", ({ Given, When, Then }) => {
    Given("the Mayor's message in the general thread is {string}", (_c, text: string) => {
      seeded.push(generalMessage(text));
    });
    When('the general thread is opened', async () => {
      await viewRepo.save({ plaintext: JSON.stringify(viewWith(now)), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
      for (const row of seeded) await messagesRepo.put(row);
      render(<TalkScreen thread="general" />);
      await screen.findByTestId('conversation');
    });
    Then('the message shows a link {string} to the bead page of {string} and no link for {string}', async (_c, name: string, id: string, plain: string) => {
      const conversation = screen.getByTestId('conversation');
      const link = await within(conversation).findByRole('link', { name });
      expect(link).toHaveAttribute('href', `?v=bead&id=${id}`);
      expect(within(conversation).queryByRole('link', { name: plain })).toBeNull();
      expect(within(conversation).getByText(plain).tagName).toBe('CODE');
    });
  });
  Scenario('mw-gq6.223: the Read aloud control speaks a message without its bead ids while the screen keeps the chips', ({ Given, When, Then, And }) => {
    Given("the Mayor's message in the general thread is {string}", (_c, text: string) => {
      seeded.push(generalMessage(text));
    });
    When('the general thread is opened and Read aloud is tapped on the message', async () => {
      await viewRepo.save({ plaintext: JSON.stringify(viewWith(now)), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
      for (const row of seeded) await messagesRepo.put(row);
      render(<TalkScreen thread="general" />);
      const conversation = await screen.findByTestId('conversation');
      fireEvent.click(await within(conversation).findByRole('button', { name: 'Read aloud' }));
    });
    Then('the phone speaks aloud {string}', (_c, text: string) => {
      // one utterance per sentence (mw-q6n8m0.9)
      expect(spoken().join(' ')).toBe(text);
    });
    And('the message still shows links {string}, {string} and {string}', async (_c, a: string, b: string, c: string) => {
      const conversation = screen.getByTestId('conversation');
      for (const id of [a, b, c]) {
        expect(await within(conversation).findByRole('link', { name: id })).toHaveAttribute('href', `?v=bead&id=${id}`);
      }
    });
  });
  Scenario("mw-gq6.224: the Read aloud control speaks a bead's short title in place of its id while the screen keeps the chip", ({ Given, When, Then, And }) => {
    Given('the view holds bead {string} titled {string}', (_c, id: string, title: string) => {
      extraBeads.push({ id, title });
    });
    And("the Mayor's message in the general thread is {string}", (_c, text: string) => {
      seeded.push(generalMessage(text));
    });
    When('the general thread is opened and Read aloud is tapped on the message', async () => {
      await viewRepo.save({ plaintext: JSON.stringify(viewWith(now)), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
      for (const row of seeded) await messagesRepo.put(row);
      render(<TalkScreen thread="general" />);
      const conversation = await screen.findByTestId('conversation');
      await within(conversation).findByRole('button', { name: 'Read aloud' });
      // The view row is read live; let it reach the screen before tapping. The speaker is a toggle
      // (mw-ym1qi9.1): a tap that read too early is stopped by the next tap, then read again. vi.waitFor
      // polls on a timer; Testing Library's waitFor would re-run on the click's own DOM change, forever.
      await vi.waitFor(() => {
        const reading = within(conversation).queryByRole('button', { name: 'Stop reading' });
        fireEvent.click(reading ?? within(conversation).getByRole('button', { name: 'Read aloud' }));
        expect(spoken().at(-1)).toContain('A decision card');
      });
    });
    Then('the phone speaks aloud {string}', (_c, text: string) => {
      expect(spoken().at(-1)).toBe(text);
    });
    And('the message still shows link {string}', async (_c, id: string) => {
      const conversation = screen.getByTestId('conversation');
      expect(await within(conversation).findByRole('link', { name: id })).toHaveAttribute('href', `?v=bead&id=${id}`);
    });
  });
});
