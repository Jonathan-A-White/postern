// features/steps/verify-card.steps.tsx — runs features/verify-card.feature (mw-tbx1n.15):
// a verify card shows its steps under "How to check it" and a button that says what a tap does;
// the approve chip is "Release", the same word as its button.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { NeedCard } from '../../src/cockpit/NeedCard';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { sendAction } from '../../src/cockpit/send';
import { db } from '../../src/data/db';
import type { Need, NeedKind } from '../../src/model/view';

configure({ asyncUtilTimeout: 5000 });

vi.mock('../../src/cockpit/send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/cockpit/send')>()),
  sendAction: vi.fn(async () => ({ txid: 'direct:aa', channel: 'direct' })),
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

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    forgetTaps();
    vi.mocked(sendAction).mockClear();
    await Promise.all([db.settings.clear(), db.answers.clear(), db.messages.clear()]);
  });

  const verifyCard = async () => {
    render(<NeedCard need={need('verify', STEPS, ['Verified'])} />);
  };

  Scenario('mw-tbx1n.15: a verify card shows How to check it and the button I checked it: it works', ({ Given, Then, And }) => {
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

  Scenario('mw-tbx1n.15: tapping I checked it: it works sends the verified action once', ({ Given, When, Then, And }) => {
    Given('a verify card whose steps are {string} and an image', verifyCard);
    When('he taps {string}', async (_c, label: string) => {
      await userEvent.click(screen.getByRole('button', { name: label }));
    });
    Then('one verified action for that bead is sent', async () => {
      await waitFor(() => expect(sendAction).toHaveBeenCalledTimes(1));
      expect(sendAction).toHaveBeenCalledWith({ action: 'verified', bead: BEAD });
    });
    And('the card says it is waiting for the factory, with no button to tap', async () => {
      const card = screen.getByTestId('need-card');
      await waitFor(() => expect(within(card).getByRole('status')).toHaveTextContent(/waiting for the factory/i));
      expect(within(card).queryByRole('group', { name: 'Answers' })).toBeNull();
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
