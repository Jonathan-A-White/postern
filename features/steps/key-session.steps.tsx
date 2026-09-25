// features/steps/key-session.steps.tsx — runs features/key-session.feature under
// vitest via @amiceli/vitest-cucumber. See gate.steps.tsx for why
// dont-cleanup-after-each is imported and cleanup() is called by hand: each
// scenario below renders more than one screen in turn and the automatic
// per-test cleanup is disabled.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { KeyVault } from '../../src/key';
import { Compose } from '../../src/compose';
import { Inbox } from '../../src/inbox';
import { ProjectsScreen } from '../../src/projects';
import { db } from '../../src/data/db';
import { lock } from '../../src/services/keySession';
import { installMockAuthenticator, removeMockAuthenticator } from '../../tests/support/webauthn-mock';

/** A fetch double so Inbox's background sync and KeyVault's balance check never
 * reach out over the network during this scenario: empty results either way. */
function quietFetchStub() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname.endsWith('/messages')) {
      return new Response(JSON.stringify({ records: [], next: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  });
}

async function freshScreen(): Promise<void> {
  cleanup();
  removeMockAuthenticator();
  await db.vault.clear();
  await db.settings.clear();
  await db.messages.clear();
  lock();
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', quietFetchStub());
}

const feature = await loadFeature('features/key-session.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('AC1: unlocking on one screen needs no second prompt on another screen', ({ Given, And, When, Then }) => {
    Given('a PRF-wrapped vault exists', async () => {
      await freshScreen();
      installMockAuthenticator({ prfSupported: true });
    });

    And('the key screen is opened and unlocked with a fingerprint', async () => {
      render(<KeyVault />);
      await userEvent.click(await screen.findByRole('button', { name: 'Generate a new key' }));
      await screen.findAllByTestId('mnemonic-word');
      await userEvent.click(screen.getByRole('button', { name: "I've written it down" }));
      await screen.findByText('Key unlocked');
    });

    When('the compose screen is opened', async () => {
      cleanup();
      render(<Compose />);
    });

    Then('the compose screen shows no fingerprint prompt', async () => {
      await screen.findByText(/Mayor's public key/);
      expect(screen.queryByText('The key is locked.')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Unlock with your fingerprint' })).not.toBeInTheDocument();
    });

    When('the inbox is opened', async () => {
      cleanup();
      render(<Inbox />);
    });

    Then('the inbox shows no fingerprint prompt', async () => {
      await screen.findByText('No messages yet.');
      expect(screen.queryByRole('button', { name: 'Unlock with your fingerprint' })).not.toBeInTheDocument();
    });

    When('the projects screen is opened', async () => {
      cleanup();
      render(<ProjectsScreen />);
    });

    Then('the projects screen shows no fingerprint prompt', async () => {
      await screen.findByRole('button', { name: 'Lock' });
      expect(screen.queryByText('The key is locked.')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Unlock with your fingerprint' })).not.toBeInTheDocument();
    });
  });

  Scenario('AC3/AC4: Lock ends the shared session so the next screen prompts again', ({ Given, And, When, Then }) => {
    Given('a PRF-wrapped vault exists', async () => {
      await freshScreen();
      installMockAuthenticator({ prfSupported: true });
    });

    And('the key screen is opened and unlocked with a fingerprint', async () => {
      render(<KeyVault />);
      await userEvent.click(await screen.findByRole('button', { name: 'Generate a new key' }));
      await screen.findAllByTestId('mnemonic-word');
      await userEvent.click(screen.getByRole('button', { name: "I've written it down" }));
      await screen.findByText('Key unlocked');
    });

    When('"Lock" is tapped on the key screen', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Lock' }));
    });

    Then('the key screen shows the locked screen', async () => {
      expect(await screen.findByText('The key is locked.')).toBeInTheDocument();
    });

    When('the compose screen is opened', async () => {
      cleanup();
      render(<Compose />);
    });

    Then('the compose screen offers to unlock with your fingerprint', async () => {
      expect(await screen.findByRole('button', { name: 'Unlock with your fingerprint' })).toBeInTheDocument();
    });
  });
});

afterAll(() => {
  cleanup();
  removeMockAuthenticator();
  lock();
  vi.unstubAllGlobals();
});
