// features/steps/door-and-bead.steps.tsx — runs features/door-and-bead.feature (mw-xhtcup.12): the Unlock screen,
// Me's 'Turn on' notifications and the bead page's description and children.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Utils } from '@bsv/sdk';
import { Unlock } from '../../src/cockpit/Gate';
import { MeScreen } from '../../src/cockpit/MeScreen';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { db, type VaultRow } from '../../src/data/db';
import { beadDetailsRepo, viewRepo } from '../../src/data/repositories';
import { getKey, lock, setKey } from '../../src/services/keySession';
import * as push from '../../src/services/push';
import { createMnemonic, deriveAesKeyFromPrf, deriveMasterKey, publicKeyHexFromMasterKey, wrapKey } from '../../src/services/vault';
import { currentToasts, dismissAllToasts } from '../../src/ui/toastStore';
import type { BeadDetail, View, ViewBead } from '../../src/model/view';
import { installMockAuthenticator, removeMockAuthenticator } from '../../tests/support/webauthn-mock';

vi.mock('../../src/services/beads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/beads')>()),
  fetchBeadDetail: vi.fn(async () => ({ status: 'ok' as const })),
}));

const HARDWARE_SECRET = new Uint8Array(32).map((_, i) => i + 1);
const KEY = new Uint8Array(Utils.toArray('33'.repeat(32), 'hex'));

async function prfVault(): Promise<VaultRow> {
  const masterKey = await deriveMasterKey(createMnemonic());
  const wrapped = await wrapKey(masterKey, await deriveAesKeyFromPrf(HARDWARE_SECRET.slice().buffer));
  return { id: 'vault', mode: 'prf', ciphertext: wrapped.ciphertext, iv: wrapped.iv, credentialId: crypto.getRandomValues(new Uint8Array(16)).buffer, publicKeyHex: publicKeyHexFromMasterKey(masterKey) };
}

function bead(id: string, title: string, priority: number, extra: Partial<ViewBead> = {}): ViewBead {
  return { id, title, type: 'task', status: 'open', priority, labels: [], assignee: '', waits: [], created: '', updated: '', started: '', closed: '', attempts: 0, summary: '', comments: 0, done_earlier: 0, ...extra };
}

async function store(beads: ViewBead[], target: string, detailExtra: Partial<BeadDetail>): Promise<void> {
  const view: View = { v: 2, written_at: '2026-10-08T00:00:00Z', host: 'desktop', hosts: [], needs: [], beads };
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, source: 'live', fetchedAt: Date.now() });
  const b = beads.find((candidate) => candidate.id === target);
  if (!b) throw new Error('target bead missing');
  const detail: BeadDetail = { v: 2, id: b.id, title: b.title, type: b.type, status: b.status, priority: b.priority, parent: b.parent, labels: [], assignee: '', waits: [], blocks: [], children: [], created: '', updated: '', started: '', closed: '', attempts: 0, description: '', acceptance: '', comments: [], ...detailExtra };
  await beadDetailsRepo.save({ id: b.id, plaintext: JSON.stringify(detail), fetchedAt: Date.now() });
}

afterAll(() => {
  cleanup();
  lock();
});

const feature = await loadFeature('features/door-and-bead.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
  let vault: VaultRow;
  let subscribe: ReturnType<typeof vi.spyOn>;
  let target = '';

  BeforeEachScenario(async () => {
    cleanup();
    lock();
    dismissAllToasts();
    await Promise.all([db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear(), db.outbox.clear(), db.settings.clear()]);
  });
  AfterEachScenario(() => {
    cleanup();
    removeMockAuthenticator();
    vi.restoreAllMocks();
    dismissAllToasts();
    lock();
  });

  const fingerprint = () => screen.getByRole('button', { name: 'Unlock with your fingerprint' });
  const unsubscribedPhone = () => {
    vi.spyOn(push, 'pushSupported').mockReturnValue(true);
    vi.spyOn(push, 'isPushSubscribed').mockResolvedValue(false);
    vi.spyOn(push, 'rememberPushSubscribed').mockResolvedValue(undefined);
    subscribe = vi.spyOn(push, 'subscribeToPush').mockResolvedValue(undefined);
    setKey(KEY);
  };
  const openMeAndTap = async () => {
    render(<MeScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
  };
  const description = () => screen.findByRole('region', { name: 'Description' });

  Scenario('mw-xhtcup.12 AC-1: a locked key behind a passkey offers the fingerprint button', ({ Given, When, Then }) => {
    Given('a phone whose key is kept behind a passkey', async () => {
      installMockAuthenticator({ prfSupported: true });
      vault = await prfVault();
    });
    When('the Unlock screen is shown', () => {
      render(<Unlock vault={vault} />);
    });
    Then('the screen offers {string}', (_c, label: string) => {
      expect(screen.getByRole('button', { name: label })).toBeEnabled();
    });
  });

  Scenario('mw-xhtcup.12 AC-2: a dismissed fingerprint prompt says it was cancelled', ({ Given, And, When, Then }) => {
    Given('a phone whose key is kept behind a passkey', async () => {
      vault = await prfVault();
    });
    And('the fingerprint prompt will be dismissed', () => {
      installMockAuthenticator({ prfSupported: true, prfGetResult: 'not-allowed' });
    });
    When('the Unlock screen is shown', () => {
      render(<Unlock vault={vault} />);
    });
    And('he taps {string}', async (_c, label: string) => {
      await userEvent.click(screen.getByRole('button', { name: label }));
    });
    Then('the screen says {string}', async (_c, text: string) => {
      expect(await screen.findByRole('alert')).toHaveTextContent(text);
    });
    And('the key is still locked', () => {
      expect(getKey()).toBeNull();
      expect(fingerprint()).toBeEnabled();
    });
  });

  Scenario('mw-xhtcup.12 AC-3: Me\'s Turn on subscribes this phone to notifications', ({ Given, When, Then, And }) => {
    Given('the key is unlocked and this phone is not yet subscribed', unsubscribedPhone);
    When('he opens Me and taps {string}', async () => {
      await openMeAndTap();
    });
    Then('the push service is asked to subscribe with his key', async () => {
      await waitFor(() => expect(subscribe).toHaveBeenCalledWith({ publicKeyHex: publicKeyHexFromMasterKey(KEY), unlockedKey: KEY }));
    });
    And('a toast says {string}', async (_c, text: string) => {
      await waitFor(() => expect(currentToasts().find((t) => t.text === text)?.tone).toBe('ok'));
    });
  });

  Scenario('mw-xhtcup.12 AC-4: Me\'s Turn on shows why a subscription failed', ({ Given, And, When, Then }) => {
    Given('the key is unlocked and this phone is not yet subscribed', unsubscribedPhone);
    And('the push service will refuse with {string}', (_c, reason: string) => {
      subscribe.mockRejectedValue(new Error(reason));
    });
    When('he opens Me and taps {string}', async () => {
      await openMeAndTap();
    });
    Then('an error toast says {string}', async (_c, text: string) => {
      await waitFor(() => expect(currentToasts().find((t) => t.text === text)?.tone).toBe('error'));
    });
    And('{string} is offered again', async (_c, label: string) => {
      await waitFor(() => expect(screen.getByRole('button', { name: label })).toBeEnabled());
    });
  });

  Scenario('mw-xhtcup.12 AC-5: a Markdown description shows as a heading and a list', ({ Given, When, Then }) => {
    Given('a bead whose description is a Markdown heading and a two-item list', async () => {
      const story = bead('mw-d.1', 'A story', 2);
      target = story.id;
      await store([story], target, { description: '## Plan\n\nDo the thing.\n\n- first step\n- second step' });
      setKey(KEY);
    });
    When('he opens the bead page', () => {
      render(<BeadScreen id={target} />);
    });
    Then('the description has a heading {string} and the items {string} and {string}', async (_c, heading: string, first: string, second: string) => {
      const section = await description();
      expect(await within(section).findByRole('heading', { level: 2, name: heading })).toBeInTheDocument();
      const items = within(within(section).getByRole('list')).getAllByRole('listitem');
      expect(items.map((li) => li.textContent)).toEqual([first, second]);
    });
  });

  Scenario('mw-xhtcup.12 AC-6: a bead with no description says so', ({ Given, When, Then }) => {
    Given('a bead with no description', async () => {
      const story = bead('mw-d.2', 'A bare story', 2);
      target = story.id;
      await store([story], target, { description: '' });
      setKey(KEY);
    });
    When('he opens the bead page', () => {
      render(<BeadScreen id={target} />);
    });
    Then('the description says {string}', async (_c, text: string) => {
      expect(await within(await description()).findByText(text)).toBeInTheDocument();
    });
  });

  Scenario('mw-xhtcup.12 AC-7: the beads inside an epic are listed by priority, then name', ({ Given, When, Then }) => {
    Given('an epic holding a P2 story {string}, a P1 story {string} and a P2 story {string}', async (_c, first: string, second: string, third: string) => {
      const epic = bead('mw-e', 'The epic', 1, { type: 'epic' });
      target = epic.id;
      await store(
        [epic, bead('mw-e.1', first, 2, { parent: 'mw-e' }), bead('mw-e.2', second, 1, { parent: 'mw-e' }), bead('mw-e.3', third, 2, { parent: 'mw-e' })],
        target,
        { children: [] },
      );
      setKey(KEY);
    });
    When('he opens the bead page', () => {
      render(<BeadScreen id={target} />);
    });
    Then('the beads inside it read {string}, {string}, {string}', async (_c, a: string, b: string, c: string) => {
      await screen.findByText('Inside');
      const links = screen.getAllByRole('link').filter((link) => link.getAttribute('href')?.includes('mw-e.'));
      expect(links.map((link) => link.textContent?.replace(/^mw-e\.\d+/, ''))).toEqual([a, b, c]);
    });
  });
});
