// features/steps/composer-draft.steps.tsx — runs features/composer-draft.feature (mw-gq6.250):
// the real Composer over fake-indexeddb, timers faked, sendToThread a stub. The draft is read
// straight from the settings row the Composer's repository writes.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, act, fireEvent, waitFor, configure } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Utils } from '@bsv/sdk';
import { Composer } from '../../src/cockpit/Composer';
import { setKey, lock } from '../../src/services/keySession';
import { db } from '../../src/data/db';
import { draftsRepo } from '../../src/data/repositories';
import { parseThreadKey } from '../../src/services/threads';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

configure({ asyncUtilTimeout: 5000 });

vi.mock('../../src/cockpit/send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/cockpit/send')>()),
  sendToThread: async () => [{ id: 1 }],
}));

const HIM_KEY = new Uint8Array(Utils.toArray('45'.repeat(32), 'hex'));

function channel(name: string) {
  return name === 'general' ? undefined : parseThreadKey(name);
}

async function fresh(): Promise<void> {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request) => (isChallengeRequest(String(url)) ? challengeResponse() : new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }))),
  );
  await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.outbox.clear()]);
  setKey(HIM_KEY);
}

afterAll(() => {
  cleanup();
  vi.useRealTimers();
  lock();
  vi.unstubAllGlobals();
});

const feature = await loadFeature('features/composer-draft.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  let open: { name: string; re?: string } = { name: 'general' };
  const puts = vi.spyOn(db.settings, 'put');
  const box = () => screen.getByRole('textbox', { name: 'Message' });
  const mount = async (name: string, re?: string) => {
    open = { name, re };
    render(<Composer thread={channel(name)} re={re} />);
    await act(async () => {
      await draftsRepo.get(draftsRepo.keyFor(channel(name), re));
    });
  };
  const typeInto = (text: string) => act(() => void fireEvent.change(box(), { target: { value: text } }));
  const pause = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await act(async () => {
      for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
    });
  };
  const stored = () => draftsRepo.get(draftsRepo.keyFor(channel(open.name), open.re));
  const closed = async () => {
    cleanup();
    vi.useRealTimers();
    // the draft is written when the composer goes, not only after the pause
    await new Promise((resolve) => setTimeout(resolve, 50));
  };

  const emptyAndOpen = async (_c: unknown, name: string) => {
    puts.mockClear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await mount(name);
  };
  const typesAndPauses = async (_c: unknown, text: string) => {
    await typeInto(text);
    await pause();
  };

  Scenario('mw-gq6.250: typing saves a draft once he pauses', ({ Given, When, Then }) => {
    Given('the {string} composer is open and empty', emptyAndOpen);
    When('he types {string} and pauses for 500 ms', typesAndPauses);
    Then('the draft stored for {string} is {string}', async (_c, _name: string, text: string) => {
      expect(await stored()).toBe(text);
    });
  });

  Scenario('mw-gq6.250: a second keystroke inside the window saves once', ({ Given, When, Then }) => {
    Given('the {string} composer is open and empty', emptyAndOpen);
    When('he types {string} and then {string} within the window and pauses', async (_c, first: string, second: string) => {
      await typeInto(first);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      await typeInto(second);
      await pause();
    });
    Then('the draft was written once and holds {string}', async (_c, text: string) => {
      expect(puts.mock.calls.filter(([row]) => String(row.key).startsWith('draft:'))).toHaveLength(1);
      expect(await stored()).toBe(text);
    });
  });

  Scenario('mw-gq6.250: the draft comes back when the composer opens again', ({ Given, When, And, Then }) => {
    Given('the {string} composer is open and empty', emptyAndOpen);
    When('he types {string} and pauses for 500 ms', typesAndPauses);
    And('the composer is closed and opened again', async () => {
      await closed();
      await mount(open.name);
    });
    Then('the composer holds {string}', async (_c, text: string) => {
      await waitFor(() => expect(box()).toHaveValue(text));
    });
  });

  Scenario('mw-gq6.250: leaving inside the window still keeps the words', ({ Given, When, And, Then }) => {
    Given('the {string} composer is open and empty', emptyAndOpen);
    When('he types {string} and the composer is closed at once', async (_c, text: string) => {
      await typeInto(text);
      await closed();
    });
    And('the composer is opened again', async () => {
      await mount(open.name);
    });
    Then('the composer holds {string}', async (_c, text: string) => {
      await waitFor(() => expect(box()).toHaveValue(text));
    });
  });

  Scenario('mw-gq6.250: Send clears the draft', ({ Given, When, And, Then }) => {
    Given('the {string} composer is open and empty', emptyAndOpen);
    When('he types {string} and pauses for 500 ms', typesAndPauses);
    And('he taps Send', async () => {
      vi.useRealTimers();
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() => expect(box()).toHaveValue(''));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    Then('no draft is stored for {string}', async () => {
      expect(await stored()).toBeUndefined();
    });
    And('the composer is empty', () => {
      expect(box()).toHaveValue('');
    });
  });

  Scenario('mw-gq6.250: an empty composer removes the draft', ({ Given, When, And, Then }) => {
    Given('the {string} composer is open and empty', emptyAndOpen);
    When('he types {string} and pauses for 500 ms', typesAndPauses);
    And('he clears the box and pauses for 500 ms', async () => {
      await typeInto('');
      await pause();
    });
    Then('no draft is stored for {string}', async () => {
      expect(await stored()).toBeUndefined();
    });
  });

  Scenario('mw-gq6.250: a draft for one channel does not show in another', ({ Given, When, And, Then }) => {
    Given('the {string} composer is open and empty', emptyAndOpen);
    When('he types {string} and pauses for 500 ms', typesAndPauses);
    And('the composer is closed and the {string} composer is opened', async (_c, name: string) => {
      await closed();
      await mount(name);
    });
    Then('the composer is empty', () => {
      expect(box()).toHaveValue('');
    });
  });

  Scenario('mw-gq6.250: a reply has its own draft apart from its channel', ({ Given, When, And, Then }) => {
    Given('the {string} composer is open and empty', emptyAndOpen);
    When('he types {string} and pauses for 500 ms', typesAndPauses);
    And('the composer is closed and a reply composer under {string} is opened', async (_c, txid: string) => {
      await closed();
      await mount('general', txid);
    });
    Then('the composer is empty', () => {
      expect(box()).toHaveValue('');
    });
  });
});
