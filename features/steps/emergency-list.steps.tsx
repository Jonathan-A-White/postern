// features/steps/emergency-list.steps.tsx — runs features/emergency-list.feature (mw-gq6.285): the
// Emergencies row on Needs you, the Emergency screen it opens, and the speaker on each emergency.
// Held events are seeded in Dexie; speech is a fake synth.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { EmergencyScreen } from '../../src/cockpit/EmergencyScreen';
import { NeedsScreen } from '../../src/cockpit/NeedsScreen';
import { useRoute } from '../../src/router';
import { stop } from '../../src/services/speech';
import { db } from '../../src/data/db';
import { eventsRepo, viewRepo } from '../../src/data/repositories';
import { fixtureView } from '../../tests/support/cockpit-fixture';

configure({ asyncUtilTimeout: 5000 });

class FakeUtterance {
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  text: string;
  constructor(text: string) {
    this.text = text;
  }
}

const utterances: FakeUtterance[] = [];
const speakFn = vi.fn((u: FakeUtterance) => utterances.push(u));
const cancelFn = vi.fn();

/** The two places this scenario walks between, chosen by the URL as App does. */
// eslint-disable-next-line react-refresh/only-export-components
function Places() {
  const route = useRoute();
  return route.view === 'emergency' ? <EmergencyScreen /> : <NeedsScreen />;
}

async function hold(words: string[]): Promise<void> {
  await eventsRepo.addNew(
    words.map((detail, i) => ({ seq: i + 1, ts: new Date().toISOString(), kind: 'alarm', bead: '', actor: 'doctor@desktop', from: '', to: '', detail, lane: 'emergency' })),
  );
}

afterAll(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/emergency-list.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    utterances.length = 0;
    speakFn.mockClear();
    cancelFn.mockClear();
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    vi.stubGlobal('speechSynthesis', { speak: speakFn, cancel: cancelFn, getVoices: () => [] });
    stop();
    await Promise.all([db.settings.clear(), db.view.clear(), db.events.clear(), db.beadDetails.clear()]);
    const now = Date.now();
    await viewRepo.save({ plaintext: JSON.stringify(fixtureView(now)), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
    window.history.replaceState(null, '', '/?v=needs');
  });

  const needsOpens = async () => {
    render(<Places />);
    await screen.findByRole('heading', { name: 'Needs you' });
  };

  Scenario('mw-gq6.285 AC1: Needs you shows an Emergencies row with the count, and a tap opens the Emergency screen', ({ Given, When, Then }) => {
    Given('the phone holds two emergencies, {string} and {string}', async (_c, first: string, second: string) => hold([first, second]));
    When('the Needs you screen opens', needsOpens);
    Then('an {string} row is shown', async (_c, name: string) => {
      expect(await screen.findByRole('button', { name })).toBeInTheDocument();
    });
    When('he taps the {string} row', async (_c, name: string) => {
      await userEvent.click(await screen.findByRole('button', { name }));
    });
    Then('the Emergency screen opens and lists {string} and {string}', async (_c, first: string, second: string) => {
      await waitFor(() => expect(window.location.search).toBe('?v=emergency'));
      expect(await screen.findByText(first)).toBeInTheDocument();
      expect(await screen.findByText(second)).toBeInTheDocument();
    });
  });

  Scenario('mw-gq6.285 AC1: Needs you shows no Emergencies row when the phone holds none', ({ Given, When, Then }) => {
    Given('the phone holds no emergency', () => undefined);
    When('the Needs you screen opens', needsOpens);
    Then('no Emergencies row is shown', async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(screen.queryByRole('button', { name: /^Emergencies/ })).not.toBeInTheDocument();
    });
  });

  Scenario('mw-gq6.285 AC2: each emergency has a Read aloud button that reads its words, then Stop reading', ({ Given, When, And, Then }) => {
    Given('the phone holds one emergency, {string}', async (_c, words: string) => hold([words]));
    When('the Emergency screen opens', async () => {
      window.history.replaceState(null, '', '/?v=emergency');
      render(<Places />);
      await screen.findByText('Disk is full');
    });
    And('he taps {string} on the emergency', async (_c, label: string) => {
      await userEvent.click(await screen.findByRole('button', { name: label }));
    });
    Then('the phone reads {string} and the button now says {string}', async (_c, words: string, label: string) => {
      expect(speakFn).toHaveBeenCalledTimes(1);
      expect(utterances[0].text).toContain(words);
      expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
    });
    When('he taps {string} on the emergency', async (_c, label: string) => {
      await userEvent.click(await screen.findByRole('button', { name: label }));
    });
    Then('the phone stops reading and the button says {string} again', async (_c, label: string) => {
      expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Stop reading' })).not.toBeInTheDocument();
    });
  });
});
