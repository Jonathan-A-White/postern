// features/steps/verify-card.steps.tsx — runs features/verify-card.feature (mw-tbx1n.15, mw-581qad.1):
// a verify card shows its steps under "How to check it" and a Verified button that asks first and then
// sends one channel message beginning VERIFIED; the approve chip is "Release", the same word as its button.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { NeedCard } from '../../src/cockpit/NeedCard';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { db } from '../../src/data/db';
import { forgetOutboxState, settledOutbox } from '../../src/services/outbox';
import { deliverThreaded } from '../../src/services/deliver';
import type { Need, NeedKind } from '../../src/model/view';

configure({ asyncUtilTimeout: 5000 });

vi.mock('../../src/services/deliver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/deliver')>()),
  deliverThreaded: vi.fn(async () => ({ txid: 'direct:aa', channel: 'direct' })),
}));
vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  deliverOptions: () => ({ key: new Uint8Array(32), mayorKey: '02' + '11'.repeat(32), direct: true }),
}));

const BEAD = 'mw-v';

function need(kind: NeedKind, text: string, options: string[]): Need {
  return { kind, bead: BEAD, epic: '', title: 'Paint the door', since: new Date(Date.now() - 60_000).toISOString(), text, recommended: '', options, blocks: 0, steps: [] };
}

const STEPS = '1. Open the Me place\n\n![The Me place](https://example.com/me.png)';

afterAll(() => {
  cleanup();
});

const feature = await loadFeature('features/verify-card.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    forgetTaps();
    forgetOutboxState();
    vi.mocked(deliverThreaded).mockClear();
    await Promise.all([db.settings.clear(), db.answers.clear(), db.messages.clear(), db.outbox.clear()]);
  });
  AfterEachScenario(() => {
    vi.useRealTimers();
    cleanup();
    forgetOutboxState();
  });

  const verifyCard = async () => {
    render(<NeedCard need={need('verify', STEPS, ['Verified'])} />);
  };

  Scenario('mw-tbx1n.15: a verify card shows How to check it and a button Verified', ({ Given, Then, And }) => {
    Given('a verify card whose steps are {string} and an image', verifyCard);
    Then('the card has the heading {string} above the steps', async (_c, heading: string) => {
      const card = screen.getByTestId('need-card');
      const title = within(card).getByRole('heading', { name: heading });
      const steps = within(card).getByText('Open the Me place');
      expect(title.compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
    And('the card offers {string} and no button called {string}', async (_c, offered: string, gone: string) => {
      const card = screen.getByTestId('need-card');
      expect(within(card).getByRole('button', { name: offered })).toBeEnabled();
      expect(within(card).queryByRole('button', { name: gone })).toBeNull();
    });
    And("the image in the steps is set to the card's full width", async () => {
      const steps = screen.getByTestId('verify-steps');
      expect(within(steps).getByRole('img', { name: 'The Me place' })).toBeInTheDocument();
      expect(steps.className).toContain('[&_img]:w-full');
    });
  });

  const tapsVerified = async (_c: unknown, label: string) => {
    await userEvent.click(screen.getByRole('button', { name: label }));
  };
  const offersVerified = async (_c: unknown, label: string) => {
    expect(within(screen.getByTestId('need-card')).getByRole('button', { name: label })).toBeEnabled();
    expect(within(screen.getByTestId('need-card')).queryByRole('button', { name: 'Yes, verified' })).toBeNull();
    expect(deliverThreaded).not.toHaveBeenCalled();
    expect(await db.outbox.count()).toBe(0);
  };

  Scenario('mw-581qad.1: tapping Verified asks first and sends nothing until he says yes', ({ Given, When, Then, And }) => {
    Given('a verify card whose steps are {string} and an image', verifyCard);
    When('he taps {string}', tapsVerified);
    Then('the card asks {string} with {string} and {string}', async (_c, question: string, yes: string, no: string) => {
      const card = screen.getByTestId('need-card');
      expect(within(card).getByText(question)).toBeInTheDocument();
      expect(within(card).getByRole('button', { name: yes })).toBeEnabled();
      expect(within(card).getByRole('button', { name: no })).toBeEnabled();
    });
    And('nothing is sent', async () => {
      await act(async () => settledOutbox());
      expect(await db.outbox.count()).toBe(0);
      expect(deliverThreaded).not.toHaveBeenCalled();
    });
  });

  Scenario('mw-581qad.1: Not yet folds the question back', ({ Given, When, And, Then }) => {
    Given('a verify card whose steps are {string} and an image', verifyCard);
    When('he taps {string}', tapsVerified);
    And('he taps {string}', tapsVerified);
    Then('the card offers {string} again and nothing is sent', offersVerified);
  });

  Scenario('mw-581qad.1: the question folds back by itself after 8 seconds untouched', ({ Given, When, And, Then }) => {
    Given('a verify card whose steps are {string} and an image', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      await verifyCard();
    });
    When('he taps {string}', async (_c, label: string) => {
      fireEvent.click(screen.getByRole('button', { name: label }));
    });
    And('{int} seconds pass', async (_c, seconds: number) => {
      act(() => void vi.advanceTimersByTime(seconds * 1000));
    });
    Then('the card offers {string} again and nothing is sent', offersVerified);
  });

  Scenario("mw-581qad.1: Yes, verified sends one VERIFIED message to the bead's channel", ({ Given, When, And, Then }) => {
    Given('a verify card whose steps are {string} and an image', verifyCard);
    When('he taps {string}', tapsVerified);
    And('he taps {string} twice', async (_c, label: string) => {
      const yes = screen.getByRole('button', { name: label });
      fireEvent.click(yes);
      fireEvent.click(yes);
    });
    Then('one message to the channel of that bead says {string}', async (_c, words: string) => {
      await waitFor(() => expect(deliverThreaded).toHaveBeenCalledTimes(1));
      await act(async () => settledOutbox());
      expect(deliverThreaded).toHaveBeenCalledTimes(1);
      expect(deliverThreaded).toHaveBeenCalledWith(expect.objectContaining({ thread: { bead: BEAD }, text: words }), expect.anything());
      const rows = await db.outbox.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: 'message', bead: BEAD, thread: `bead:${BEAD}`, payload: { settles: 'verified' } });
    });
    And('the card says it is waiting for the factory, with no button to tap', async () => {
      const card = screen.getByTestId('need-card');
      await waitFor(() => expect(within(card).getByRole('status')).toHaveTextContent(/waiting for the factory/i));
      expect(within(card).queryByRole('button', { name: 'Verified' })).toBeNull();
      expect(within(card).queryByRole('button', { name: 'Yes, verified' })).toBeNull();
    });
  });

  Scenario('mw-581qad.1: a verify card waiting on the Mayor offers Verified too', ({ Given, Then }) => {
    Given('a verify card waiting on the Mayor to check the landing', async () => {
      render(<NeedCard need={{ ...need('verify', '', ['Verified']), waits_for: 'mayor', not_ready: true, waiting_on: ['the Mayor to check the landing'] }} />);
    });
    Then('the card says {string} and offers {string}', async (_c, chip: string, button: string) => {
      const card = screen.getByTestId('need-card');
      expect(within(card).getByText(chip)).toBeInTheDocument();
      expect(within(card).getByRole('button', { name: button })).toBeEnabled();
    });
  });

  Scenario('mw-tbx1n.15: a verify card with no steps has no How to check it heading', ({ Given, Then }) => {
    Given('a verify card with no steps', async () => {
      render(<NeedCard need={need('verify', '', ['Verified'])} />);
    });
    Then('the card has no {string} heading', async (_c, heading: string) => {
      expect(screen.queryByRole('heading', { name: heading })).toBeNull();
    });
  });

  Scenario('mw-tbx1n.15: the approve chip and button share one word', ({ Given, Then }) => {
    Given('an approve card', async () => {
      render(<NeedCard need={need('approve', '', ['Release'])} />);
    });
    Then('the chip and the button both say {string} and nothing says {string}', async (_c, word: string, not: string) => {
      const card = screen.getByTestId('need-card');
      expect(card.getAttribute('aria-label')).toBe('Release: Paint the door');
      expect(within(card).getAllByText(word).length).toBe(2);
      expect(within(card).getByRole('button', { name: word })).toBeInTheDocument();
      expect(card.textContent).not.toContain(not);
    });
  });
});
