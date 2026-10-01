// features/steps/prompt-call.steps.tsx — runs features/prompt-call.feature (mw-nqur1n.5):
// the real Composer against a stubbed GET /api/prompts; sendToThread is a spy, so what the
// scenario checks is the text the composer hands it.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, waitFor, within, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Utils } from '@bsv/sdk';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Composer } from '../../src/cockpit/Composer';
import { setKey, lock } from '../../src/services/keySession';
import { db } from '../../src/data/db';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';
import type { Prompt } from '../../src/services/prompts';

configure({ asyncUtilTimeout: 5000 });

const sent = vi.hoisted(() => ({ texts: [] as string[] }));

vi.mock('../../src/cockpit/send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/cockpit/send')>()),
  sendToThread: async (_thread: unknown, text: string) => {
    sent.texts.push(text);
    return [{ id: 1 }];
  },
}));

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

function backendHas(...names: string[]): void {
  const list = names.map((name) => PROMPTS[name]).sort((a, b) => a.name.localeCompare(b.name));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (isChallengeRequest(target)) return challengeResponse();
      if (target.endsWith('/prompts')) return new Response(JSON.stringify(list), { status: 200, headers: { 'Content-Type': 'application/json', ETag: '"v1"' } });
      return new Response('{}', { status: 404 });
    }),
  );
}

async function fresh(): Promise<void> {
  cleanup();
  vi.unstubAllGlobals();
  sent.texts = [];
  await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.outbox.clear()]);
  setKey(HIM_KEY);
}

afterAll(() => {
  cleanup();
  lock();
  vi.unstubAllGlobals();
});

const feature = await loadFeature('features/prompt-call.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const backendHasTwo = () => backendHas('top5', 'sweep');
  const box = () => screen.getByRole('textbox', { name: 'Message' });
  const sendButton = () => screen.getByRole('button', { name: 'Send' });
  const list = () => screen.queryByRole('listbox', { name: 'Saved prompts' });

  const types = async (_c: unknown, text: string) => {
    render(<Composer thread={undefined} />);
    await userEvent.click(box());
    await userEvent.paste(text);
  };
  const sendIsEnabled = async () => {
    await waitFor(() => expect(sendButton()).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  };
  const sendIsDisabled = async () => {
    await waitFor(() => expect(sendButton()).toBeDisabled());
  };
  const errorShows = async (_c: unknown, error: string) => {
    expect(await screen.findByRole('alert')).toHaveTextContent(error);
  };
  const taps = async () => {
    await userEvent.click(sendButton());
  };
  const messageSent = async (_c: unknown, text: string) => {
    await waitFor(() => expect(sent.texts).toEqual([text]));
  };

  Scenario('mw-nqur1n.5: typing a slash lists the prompts with their summaries and signatures', ({ Given, When, Then, And }) => {
    Given('the backend has the prompts {string} and {string}', backendHasTwo);
    When('he types {string} in the composer', types);
    Then('the list offers {string} and {string}', async (_c, first: string, second: string) => {
      const options = await screen.findAllByRole('option');
      expect(options).toHaveLength(2);
      expect(options[0]).toHaveTextContent(first);
      expect(options[1]).toHaveTextContent(second);
    });
    And('the list shows {string} and the chip {string}', async (_c, summary: string, chip: string) => {
      const inList = within(await screen.findByRole('listbox', { name: 'Saved prompts' }));
      expect(inList.getByText(summary)).toBeInTheDocument();
      expect(inList.getByText(chip)).toBeInTheDocument();
    });
  });

  Scenario('mw-nqur1n.5: choosing a prompt from the list fills in its name and keeps the cursor in the box', ({ Given, When, And, Then }) => {
    Given('the backend has the prompts {string} and {string}', backendHasTwo);
    When('he types {string} in the composer', types);
    And('he chooses {string} from the list', async (_c, name: string) => {
      await userEvent.click(await screen.findByRole('option', { name: new RegExp(`^${name}`) }));
    });
    Then('the composer holds {string}', async (_c, text: string) => {
      await waitFor(() => expect(box()).toHaveValue(text));
    });
    And('the box has the cursor', async () => {
      await waitFor(() => expect(box()).toHaveFocus());
      expect((box() as HTMLTextAreaElement).selectionStart).toBe((box() as HTMLTextAreaElement).value.length);
    });
  });

  Scenario('mw-nqur1n.5: a good call enables Send and goes out as the text he typed', ({ Given, When, Then }) => {
    Given('the backend has the prompts {string} and {string}', backendHasTwo);
    When('he types {string} in the composer', types);
    Then('Send is enabled and no error shows', sendIsEnabled);
    When('he taps Send', taps);
    Then('the message {string} is sent', messageSent);
  });

  Scenario('mw-nqur1n.5: an unknown prompt shows its name and keeps Send disabled', ({ Given, When, Then, And }) => {
    Given('the backend has the prompts {string} and {string}', backendHasTwo);
    When('he types {string} in the composer', types);
    Then('the error {string} shows', errorShows);
    And('Send is disabled', sendIsDisabled);
  });

  Scenario('mw-nqur1n.5: a bad option value shows what it wants and keeps Send disabled', ({ Given, When, Then, And }) => {
    Given('the backend has the prompts {string} and {string}', backendHasTwo);
    When('he types {string} in the composer', types);
    Then('the error {string} shows', errorShows);
    And('Send is disabled', sendIsDisabled);
  });

  Scenario('mw-nqur1n.5: a message not beginning with a slash is untouched', ({ Given, When, Then, And }) => {
    Given('the backend has the prompts {string} and {string}', backendHasTwo);
    When('he types {string} in the composer', types);
    Then('no list and no error show', async () => {
      expect(list()).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
    And('Send is enabled and no error shows', sendIsEnabled);
    When('he taps Send', taps);
    Then('the message {string} is sent', messageSent);
  });
});
