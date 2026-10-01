// features/steps/prompts.steps.tsx — runs features/prompts.feature (mw-nqur1n.4): the
// Prompts screen against a stubbed GET /api/prompts and a Dexie, with a stand-in for
// App's routing so Run and Edit land in the real Talk screen.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, waitFor, within, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Utils } from '@bsv/sdk';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PromptsScreen } from '../../src/cockpit/PromptsScreen';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { TalkLineScreen } from '../../src/cockpit/TalkLineScreen';
import { MeScreen } from '../../src/cockpit/MeScreen';
import { useRoute } from '../../src/router';
import { setKey, lock } from '../../src/services/keySession';
import { db } from '../../src/data/db';
import { messagesRepo, settingsRepo } from '../../src/data/repositories';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';
import type { Prompt } from '../../src/services/prompts';

configure({ asyncUtilTimeout: 5000 });

const HIM_KEY = new Uint8Array(Utils.toArray('45'.repeat(32), 'hex'));

const PROMPTS: Record<string, Prompt> = {
  top5: {
    name: 'top5',
    summary: 'The five things that matter',
    signature: [{ flag: '--duration', type: 'duration', default: '30m' }],
    body: 'List five things, shortest first.',
    updatedAt: '2026-10-01T12:00:00Z',
    updatedBy: '02'.padEnd(66, '0'),
  },
  sweep: {
    name: 'sweep',
    summary: 'Sweep a place',
    signature: [{ flag: '--who', type: 'string', required: true, help: 'whose place' }],
    body: 'Sweep {{who}}.',
    updatedAt: '2026-10-01T12:00:00Z',
    updatedBy: '02'.padEnd(66, '0'),
  },
};

const listOf = (...names: string[]): Prompt[] => names.map((name) => PROMPTS[name]).sort((a, b) => a.name.localeCompare(b.name));

function backendHas(...names: string[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (isChallengeRequest(target)) return challengeResponse();
      if (target.endsWith('/prompts')) return new Response(JSON.stringify(listOf(...names)), { status: 200, headers: { 'Content-Type': 'application/json', ETag: '"v1"' } });
      return new Response('{}', { status: 404 });
    }),
  );
}

function backendIsDown(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }),
  );
}

async function fresh(): Promise<void> {
  cleanup();
  vi.unstubAllGlobals();
  await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.outbox.clear()]);
  setKey(HIM_KEY);
  window.history.replaceState(null, '', '/?v=prompts');
}

// A stand-in for App's routing.
// eslint-disable-next-line react-refresh/only-export-components
function Harness() {
  const route = useRoute();
  if (route.view === 'prompts') return <PromptsScreen />;
  if (route.view === 'talk') return <TalkScreen thread={route.thread} root={route.root} prefill={route.prefill} />;
  if (route.view === 'line') return <TalkLineScreen />;
  if (route.view === 'me') return <MeScreen />;
  return <div>Elsewhere</div>;
}

const rowOf = async (name: string) => within(await screen.findByTestId(`prompt-${name}`));

afterAll(() => {
  cleanup();
  lock();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/prompts.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const open = async () => {
    render(<Harness />);
  };
  const backendHasTwo = () => backendHas('top5', 'sweep');
  const summaryShown = async (_c: unknown, name: string, summary: string) => {
    expect((await rowOf(name.slice(1))).getByText(summary)).toBeInTheDocument();
  };
  const chipShown = async (_c: unknown, name: string, chip: string) => {
    expect((await rowOf(name.slice(1))).getByText(chip)).toBeInTheDocument();
  };
  const tap = (label: string) => async (_c: unknown, name: string) => {
    await userEvent.click((await rowOf(name.slice(1))).getByRole('button', { name: label }));
  };
  const channelOpen = async (_c: unknown, channel: string) => {
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('t')).toBe(`topic:${channel}`));
  };

  Scenario('mw-nqur1n.4: the list shows each prompt with its name, summary and signature', ({ Given, When, Then, And }) => {
    Given('the backend has the prompts {string} and {string}', backendHasTwo);
    When('the Prompts screen opens', open);
    Then('the row {string} shows the summary {string}', summaryShown);
    And('the row {string} shows the option chip {string}', chipShown);
    And('the row {string} lists the option chip {string}', chipShown);
  });

  Scenario("mw-nqur1n.4: Run opens the general channel with the composer saying the prompt's name", ({ Given, When, And, Then }) => {
    Given('the backend has the prompts {string} and {string}', backendHasTwo);
    When('the Prompts screen opens', open);
    And('Run is tapped on the row {string}', tap('Run'));
    Then('the composer holds {string}', async (_c, text: string) => {
      const box = await screen.findByRole('textbox', { name: 'Message' });
      await waitFor(() => expect(box).toHaveValue(text));
    });
  });

  Scenario('mw-nqur1n.4: Edit opens the channel prompt:top5 showing the current body', ({ Given, When, And, Then }) => {
    Given('the backend has the prompts {string} and {string}', backendHasTwo);
    When('the Prompts screen opens', open);
    And('Edit is tapped on the row {string}', tap('Edit'));
    Then('the channel {string} is open', channelOpen);
    And('a note headed {string} shows the body {string}', async (_c, heading: string, body: string) => {
      const note = await screen.findByTestId('prompt-current');
      expect(note).toHaveTextContent(heading);
      expect(note).toHaveTextContent(body);
    });
  });

  Scenario('mw-nqur1n.4: a channel that already has words shows no current-body note', ({ Given, And, When, Then }) => {
    Given('the backend has the prompts {string} and {string}', backendHasTwo);
    And('the channel {string} already has a message from the Mayor', async (_c, channel: string) => {
      await messagesRepo.put({
        id: `${'ab'.repeat(32)}:0`,
        txid: 'ab'.repeat(32),
        vout: 0,
        seq: 1,
        class: 'message',
        to: '02'.padEnd(66, '0'),
        from: '03'.padEnd(66, '0'),
        ts: Math.floor(Date.now() / 1000),
        ciphertext: '',
        plaintext: 'Tell me what to change',
        direction: 'received',
        read: true,
        thread: `topic:${channel}`,
      });
    });
    When('the Prompts screen opens', open);
    And('Edit is tapped on the row {string}', tap('Edit'));
    Then('the channel {string} is open', channelOpen);
    And('no {string} note is shown', async () => {
      await screen.findByText('Tell me what to change');
      expect(screen.queryByTestId('prompt-current')).not.toBeInTheDocument();
    });
  });

  Scenario('mw-nqur1n.4: offline the cached list shows with the time it was fetched', ({ Given, When, Then, And }) => {
    Given('the phone fetched the prompts {string} and {string} at {string} and is now offline', async (_c, _a: string, _b: string, at: string) => {
      const [hours, minutes] = at.split(':').map(Number);
      await settingsRepo.setPromptsCache({ etag: '"v1"', prompts: listOf('top5', 'sweep'), at: new Date(2026, 9, 1, hours, minutes).getTime() });
      backendIsDown();
    });
    When('the Prompts screen opens', open);
    Then('the row {string} shows the summary {string}', summaryShown);
    And('the screen says {string}', async (_c, words: string) => {
      expect(await screen.findByText(new RegExp(words))).toBeInTheDocument();
    });
  });

  Scenario('mw-nqur1n.4: with nothing cached and no network the screen says so', ({ Given, When, Then }) => {
    Given('the phone has never fetched the prompts and is offline', backendIsDown);
    When('the Prompts screen opens', open);
    Then('the screen says {string}', async (_c, words: string) => {
      expect(await screen.findByText(new RegExp(words))).toBeInTheDocument();
    });
  });

  Scenario('mw-nqur1n.4: the Me screen has a Prompts row that opens the Prompts screen', ({ When, Then }) => {
    When('the Me screen opens', async () => {
      window.history.replaceState(null, '', '/?v=me');
      render(<Harness />);
    });
    Then('a {string} link leads to the Prompts screen', async (_c, label: string) => {
      expect(await screen.findByRole('link', { name: new RegExp(label) })).toHaveAttribute('href', '?v=prompts');
    });
  });

  Scenario('mw-nqur1n.4: the Talk line screen has a Prompts link that opens the Prompts screen', ({ When, Then }) => {
    When('the Talk line screen opens', async () => {
      window.history.replaceState(null, '', '/?v=line');
      backendIsDown();
      render(<Harness />);
    });
    Then('a {string} link leads to the Prompts screen', async (_c, label: string) => {
      expect(await screen.findByRole('link', { name: label })).toHaveAttribute('href', '?v=prompts');
    });
  });
});
