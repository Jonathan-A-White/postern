// features/steps/move-home.steps.tsx — runs features/move-home.feature under
// vitest via @amiceli/vitest-cucumber: the real Me screen and Shell, with only
// the delivery of the message replaced by a spy.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { MeScreen } from '../../src/cockpit/MeScreen';
import { Shell } from '../../src/cockpit/Shell';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { apiFetch } from '../../src/services/apiAuth';
import { deliverMoveHome } from '../../src/services/deliver';
import { clearStandby } from '../../src/services/standby';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';
import { fixtureView } from '../../tests/support/cockpit-fixture';

const { KEY } = vi.hoisted(() => ({ KEY: new Uint8Array(32) }));

vi.mock('../../src/services/deliver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/deliver')>()),
  deliverMoveHome: vi.fn(async () => ({ txid: 'direct:' + '1'.repeat(64), channel: 'direct' as const })),
}));
vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  deliverOptions: () => ({ key: KEY, mayorKey: '02' + '11'.repeat(32), direct: true }),
}));
vi.mock('../../src/services/keySession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/keySession')>()),
  getKey: () => KEY,
}));

async function fresh(): Promise<void> {
  cleanup();
  clearStandby();
  vi.mocked(deliverMoveHome).mockClear();
  await Promise.all([db.view.clear(), db.messages.clear()]);
}

async function storeView(host: string): Promise<void> {
  const view = fixtureView(Date.now());
  view.host = host;
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, source: 'live', fetchedAt: Date.now() });
}

const feature = await loadFeature('features/move-home.feature');

describeFeature(feature, ({ Scenario }) => {
  afterAll(() => cleanup());

  Scenario('AC-1: the Me screen shows the home and disables its own button', ({ Given, When, Then, And }) => {
    Given('the view names the desktop as home', async () => {
      await fresh();
      await storeView('desktop');
    });
    When('the Me screen is opened', () => {
      render(<MeScreen />);
    });
    Then('the Home row shows "desktop"', async () => {
      expect(await within(await screen.findByLabelText('Home')).findByText('desktop')).toBeInTheDocument();
    });
    And('"Move home to desktop" is disabled', () => {
      expect(screen.getByRole('button', { name: 'Move home to desktop' })).toBeDisabled();
    });
    And('"Move home to laptop" is enabled', () => {
      expect(screen.getByRole('button', { name: 'Move home to laptop' })).toBeEnabled();
    });
  });

  Scenario('AC-2: nothing is sent until he confirms the move', ({ Given, And, When, Then }) => {
    Given('the view names the desktop as home', async () => {
      await fresh();
      await storeView('desktop');
    });
    And('the Me screen is opened', () => {
      render(<MeScreen />);
    });
    When('he taps "Move home to laptop"', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Move home to laptop' }));
    });
    Then('he is asked "Move the factory\'s home to laptop? The Mayor there takes over."', async () => {
      expect(await screen.findByText("Move the factory's home to laptop? The Mayor there takes over.")).toBeInTheDocument();
    });
    And('nothing has been sent', () => {
      expect(deliverMoveHome).not.toHaveBeenCalled();
    });
    When('he confirms', async () => {
      await userEvent.click(within(screen.getByRole('group', { name: 'Confirm' })).getByRole('button', { name: 'Move home' }));
    });
    Then('one move-home message for "laptop" is sent', async () => {
      await waitFor(() => expect(deliverMoveHome).toHaveBeenCalledTimes(1));
      expect(vi.mocked(deliverMoveHome).mock.calls[0][0]).toBe('laptop');
    });
  });

  Scenario('AC-3: a standby answer offers the move on any screen', ({ Given, When, Then, And }) => {
    Given('the API answers 503 standby with home "desktop"', async () => {
      await fresh();
      const fetchImpl = vi.fn(async (url: string | URL | Request) =>
        isChallengeRequest(String(url)) ? challengeResponse() : new Response(JSON.stringify({ standby: true, home: 'desktop' }), { status: 503 }),
      );
      await act(async () => {
        await apiFetch('/view', undefined, { unlockedKey: new Uint8Array(32), fetchImpl: fetchImpl as unknown as typeof fetch });
      });
    });
    When('any screen is opened', () => {
      render(
        <Shell route={{ view: 'search' }}>
          <p>a screen</p>
        </Shell>,
      );
    });
    Then('the status area says "Home is down"', async () => {
      expect(await screen.findByText('Home is down')).toBeInTheDocument();
    });
    And('it offers "Move home to laptop" but not "Move home to desktop"', () => {
      expect(screen.getByRole('button', { name: 'Move home to laptop' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Move home to desktop' })).toBeNull();
    });
  });
});
