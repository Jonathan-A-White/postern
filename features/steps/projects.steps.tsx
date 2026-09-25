// features/steps/projects.steps.tsx — runs features/projects.feature under
// vitest via @amiceli/vitest-cucumber, the same fetch-stub approach
// features/steps/messages.steps.tsx uses instead of msw.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey, PublicKey, Utils } from '@bsv/sdk';
import { EncryptedMessage } from 'spell-forge-bsv';
import { App } from '../../src/App';
import { setMayorPublicKey } from '../../src/services/messages';
import { ProjectsScreen, ProjectScreen } from '../../src/projects';
import { db } from '../../src/data/db';
import { vaultRepo } from '../../src/data/repositories';
import {
  createMnemonic,
  deriveAesKeyFromPhrase,
  deriveMasterKey,
  publicKeyHexFromMasterKey,
  wrapKey,
} from '../../src/services/vault';
import type { Snapshot } from '../../src/services/questions';
import { installMockAuthenticator, removeMockAuthenticator } from '../../tests/support/webauthn-mock';
import { lock } from '../../src/services/keySession';

const MAYOR_KEY = PrivateKey.fromHex('66'.repeat(32));

async function freshScreen(): Promise<void> {
  cleanup();
  removeMockAuthenticator();
  await db.vault.clear();
  await db.settings.clear();
  await db.messages.clear();
  await db.snapshot.clear();
  lock();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
}

/** Saves a PRF-mode vault whose fingerprint prompt is mocked to reject with a
 * dismissed/timed-out NotAllowedError: the unwrap never runs, so the wrapped
 * key material itself doesn't need to be genuine. */
async function savePrfVaultWithDismissedPrompt(): Promise<void> {
  installMockAuthenticator({ prfSupported: true, prfGetResult: 'not-allowed' });
  const key = await deriveMasterKey(createMnemonic());
  await vaultRepo.save({
    mode: 'prf',
    ciphertext: new ArrayBuffer(16),
    iv: new Uint8Array(12),
    credentialId: crypto.getRandomValues(new Uint8Array(16)).buffer,
    publicKeyHex: publicKeyHexFromMasterKey(key),
  });
}

async function saveVaultForHim(): Promise<{ mnemonic: string; publicKeyHex: string }> {
  const mnemonic = createMnemonic();
  const key = await deriveMasterKey(mnemonic);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const aesKey = await deriveAesKeyFromPhrase(mnemonic, salt);
  const wrapped = await wrapKey(key, aesKey);
  const publicKeyHex = publicKeyHexFromMasterKey(key);
  await vaultRepo.save({
    mode: 'phrase',
    ciphertext: wrapped.ciphertext,
    iv: wrapped.iv,
    salt,
    prfFallbackReason: 'webauthn-unavailable',
    publicKeyHex,
  });
  return { mnemonic, publicKeyHex };
}

function encryptSnapshot(snapshot: Snapshot, recipientPublicKeyHex: string): string {
  const plaintextBytes = Utils.toArray(JSON.stringify(snapshot), 'utf8');
  const encrypted = EncryptedMessage.encrypt(plaintextBytes, MAYOR_KEY, PublicKey.fromString(recipientPublicKeyHex));
  return Utils.toBase64(encrypted);
}

function snapshotFetchMock(base64: string) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.endsWith('/snapshot')) throw new Error(`unexpected fetch: ${url}`);
    return new Response(base64, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  });
}

function unreachableFetchMock() {
  return vi.fn(async () => {
    throw new Error('the network is unreachable');
  });
}

function indexHtmlFetchMock() {
  const indexHtml =
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="UTF-8" />\n<title>Postern</title>\n</head>\n<body>\n<div id="root"></div>\n</body>\n</html>\n';
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.endsWith('/snapshot')) throw new Error(`unexpected fetch: ${url}`);
    return new Response(indexHtml, { status: 200, headers: { 'Content-Type': 'text/html' } });
  });
}

async function unlockScreen(mnemonic: string): Promise<void> {
  await userEvent.type(await screen.findByLabelText('Recovery phrase'), mnemonic);
  await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
}

const feature = await loadFeature('features/projects.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario(
    'AC-1: the Projects screen orders epics by priority with a question first, and shows counts',
    ({ Given, When, Then, And }) => {
      let mnemonic: string;

      Given(
        'the snapshot has a higher-priority epic with nothing needing him and a lower-priority epic holding a question',
        async () => {
          await freshScreen();
          const him = await saveVaultForHim();
          mnemonic = him.mnemonic;
          const snapshot: Snapshot = {
            written_at: new Date().toISOString(),
            epics: [
              {
                id: 'mw-alpha',
                title: 'Alpha project',
                priority: 'P0',
                status: 'in-progress',
                needs_you: [],
                landed: [{ id: 'mw-alpha.1', title: 'Landed thing', landed_at: '2026-09-24T10:00:00Z' }],
                working: [
                  {
                    id: 'mw-alpha.2',
                    title: 'Working thing',
                    status: 'in-progress',
                    priority: 'P0',
                    updated_at: '2026-09-24T09:00:00Z',
                    waits: [],
                  },
                ],
                closed_count: 0,
              },
              {
                id: 'mw-beta',
                title: 'Beta project',
                priority: 'P2',
                status: 'in-progress',
                needs_you: [
                  {
                    id: 'mw-beta.1',
                    title: 'Ship now or wait?',
                    asked_at: '2026-09-24T08:00:00Z',
                    recommended: 'ship',
                    options: ['ship', 'wait'],
                  },
                ],
                landed: [],
                working: [],
                closed_count: 0,
              },
            ],
          };
          vi.stubGlobal('fetch', snapshotFetchMock(encryptSnapshot(snapshot, him.publicKeyHex)));
        },
      );

      When('the Projects screen is opened and unlocked', async () => {
        render(<ProjectsScreen />);
        await unlockScreen(mnemonic);
      });

      Then('the epic holding the question is listed before the other epic', async () => {
        const rows = await screen.findAllByTestId('epic-row');
        expect(rows).toHaveLength(2);
        expect(within(rows[0]).getByText('Beta project')).toBeInTheDocument();
        expect(within(rows[1]).getByText('Alpha project')).toBeInTheDocument();
      });

      And("each epic's row shows its Needs you, Landed and Working counts", async () => {
        const rows = await screen.findAllByTestId('epic-row');
        expect(within(rows[0]).getByText('P2 · Needs you 1 · Landed 0 · Working 0')).toBeInTheDocument();
        expect(within(rows[1]).getByText('P0 · Needs you 0 · Landed 1 · Working 1')).toBeInTheDocument();
      });
    },
  );

  Scenario(
    'AC-2: the Project screen shows Needs you, Landed and Working in order, each sorted correctly',
    ({ Given, When, Then, And }) => {
      let mnemonic: string;

      Given('the snapshot has one epic with two needs-you questions, two landings and two working stories', async () => {
        await freshScreen();
        const him = await saveVaultForHim();
        mnemonic = him.mnemonic;
        const snapshot: Snapshot = {
          written_at: new Date().toISOString(),
          epics: [
            {
              id: 'mw-epic',
              title: 'The epic',
              priority: 'P1',
              status: 'in-progress',
              needs_you: [
                {
                  id: 'mw-epic.n2',
                  title: 'Newer question',
                  asked_at: '2026-09-24T10:00:00Z',
                  recommended: 'a',
                  options: ['a', 'b'],
                },
                {
                  id: 'mw-epic.n1',
                  title: 'Older question',
                  asked_at: '2026-09-24T08:00:00Z',
                  recommended: 'a',
                  options: ['a', 'b'],
                },
              ],
              landed: [
                { id: 'mw-epic.l1', title: 'Older landing', landed_at: '2026-09-23T10:00:00Z' },
                { id: 'mw-epic.l2', title: 'Newer landing', landed_at: '2026-09-24T10:00:00Z' },
              ],
              working: [
                {
                  id: 'mw-epic.w1',
                  title: 'Ready story',
                  status: 'ready',
                  priority: 'P0',
                  updated_at: '2026-09-24T09:00:00Z',
                  waits: [],
                },
                {
                  id: 'mw-epic.w2',
                  title: 'In-progress story',
                  status: 'in-progress',
                  priority: 'P2',
                  updated_at: '2026-09-24T09:00:00Z',
                  waits: [],
                },
              ],
              closed_count: 0,
            },
          ],
        };
        vi.stubGlobal('fetch', snapshotFetchMock(encryptSnapshot(snapshot, him.publicKeyHex)));
      });

      When('the Project screen is opened and unlocked', async () => {
        render(<ProjectScreen epicId="mw-epic" />);
        await unlockScreen(mnemonic);
      });

      Then('the groups appear in the order Needs you, Landed, Working', async () => {
        const headings = await screen.findAllByRole('heading', { level: 2 });
        expect(headings.map((h) => h.textContent)).toEqual(['Needs you', 'Landed', 'Working']);
      });

      And('the Needs you questions are listed oldest first', async () => {
        const rows = await screen.findAllByTestId('needs-you-row');
        expect(rows.map((row) => within(row).getByRole('link').textContent)).toEqual([
          expect.stringContaining('Older question'),
          expect.stringContaining('Newer question'),
        ]);
      });

      And('the Landed items are listed newest first', async () => {
        const rows = await screen.findAllByTestId('landed-row');
        expect(rows.map((row) => within(row).getByRole('link').textContent)).toEqual([
          expect.stringContaining('Newer landing'),
          expect.stringContaining('Older landing'),
        ]);
      });

      And('the Working stories are listed in-progress first, then ready by priority', async () => {
        const rows = await screen.findAllByTestId('working-row');
        expect(rows.map((row) => within(row).getByRole('link').textContent)).toEqual([
          expect.stringContaining('In-progress story'),
          expect.stringContaining('Ready story'),
        ]);
      });
    },
  );

  Scenario('AC-3: a failed fetch shows the cached snapshot with its age and offline', ({ Given, When, Then }) => {
    let mnemonic: string;

    Given('the Projects screen has already fetched and cached a snapshot', async () => {
      await freshScreen();
      const him = await saveVaultForHim();
      mnemonic = him.mnemonic;
      const snapshot: Snapshot = {
        written_at: new Date(Date.now() - 5 * 60_000).toISOString(),
        epics: [
          {
            id: 'mw-epic',
            title: 'The epic',
            priority: 'P1',
            status: 'in-progress',
            needs_you: [],
            landed: [],
            working: [],
            closed_count: 0,
          },
        ],
      };
      vi.stubGlobal('fetch', snapshotFetchMock(encryptSnapshot(snapshot, him.publicKeyHex)));

      render(<ProjectsScreen />);
      await unlockScreen(mnemonic);
      await screen.findByText('The epic');
    });

    When('the Projects screen is opened again while the backend is unreachable', async () => {
      cleanup();
      vi.stubGlobal('fetch', unreachableFetchMock());
      render(<ProjectsScreen />);
      // mw-tfne4.23: the key unlocked moments ago is still cached, no second prompt.
    });

    Then('the cached snapshot is shown with "Offline, as of" and its age', async () => {
      expect(await screen.findByText(/^Offline, as of \d+ min ago$/)).toBeInTheDocument();
      expect(await screen.findByText('The epic')).toBeInTheDocument();
    });
  });

  Scenario("AC-4: tapping a Needs you row opens the bead screen with the question's brief", ({ Given, And, When, Then }) => {
    let mnemonic: string;

    Given('the snapshot has one epic with one needs-you question', async () => {
      await freshScreen();
      const him = await saveVaultForHim();
      mnemonic = him.mnemonic;
      await setMayorPublicKey(MAYOR_KEY.toPublicKey().toString());
      const snapshot: Snapshot = {
        written_at: new Date().toISOString(),
        epics: [
          {
            id: 'mw-beta',
            title: 'Beta project',
            priority: 'P2',
            status: 'in-progress',
            needs_you: [
              {
                id: 'mw-beta.1',
                title: 'Ship now or wait?',
                asked_at: '2026-09-24T08:00:00Z',
                recommended: 'ship',
                options: ['ship', 'wait'],
              },
            ],
            landed: [],
            working: [],
            closed_count: 0,
          },
        ],
      };
      vi.stubGlobal('fetch', snapshotFetchMock(encryptSnapshot(snapshot, him.publicKeyHex)));
    });

    And('the Project screen is opened and unlocked', async () => {
      render(<ProjectScreen epicId="mw-beta" />);
      await unlockScreen(mnemonic);
      await screen.findByText('Ship now or wait?');
    });

    When("the question's row is tapped", async () => {
      const link = screen.getByRole('link', { name: /Ship now or wait\?/ });
      const href = link.getAttribute('href');
      if (!href) throw new Error('the row has no href');
      cleanup();
      window.history.pushState({}, '', href);
      render(<App />);
      // mw-tfne4.23: the key unlocked on the Project screen carries over, no second prompt.
    });

    Then('the bead screen shows the question\'s title, "Needs you", its recommended answer and its options', async () => {
      expect(await screen.findByText('Ship now or wait?')).toBeInTheDocument();
      expect(screen.getByText('Needs you')).toBeInTheDocument();
      expect(await screen.findByTestId('option-ship')).toBeInTheDocument();
      expect(screen.getByTestId('option-wait')).toBeInTheDocument();
      expect(screen.getByText('Recommended: ship')).toBeInTheDocument();
    });
  });

  Scenario('AC-5: a non-snapshot body at /snapshot shows a friendly message, not a decoder error', ({ Given, When, Then }) => {
    let mnemonic: string;

    Given("the backend answers /snapshot with the SPA's index.html instead of a snapshot", async () => {
      await freshScreen();
      const him = await saveVaultForHim();
      mnemonic = him.mnemonic;
      vi.stubGlobal('fetch', indexHtmlFetchMock());
    });

    When('the Projects screen is opened and unlocked', async () => {
      render(<ProjectsScreen />);
      await unlockScreen(mnemonic);
    });

    Then('the Projects screen shows "No snapshot published yet" and no decoder error', async () => {
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe('No snapshot published yet.');
    });
  });

  Scenario(
    'mw-tfne4.18 AC2: a dismissed fingerprint prompt on the projects screen says "Unlock cancelled"',
    ({ Given, When, Then, And }) => {
      Given('the Projects screen is opened with a PRF-wrapped vault and the fingerprint prompt will be dismissed', async () => {
        await freshScreen();
        await savePrfVaultWithDismissedPrompt();
        render(<ProjectsScreen />);
        await screen.findByRole('button', { name: 'Unlock with your fingerprint' });
      });

      When('"Unlock with your fingerprint" is tapped', async () => {
        await userEvent.click(screen.getByRole('button', { name: 'Unlock with your fingerprint' }));
      });

      Then('the error says "Unlock cancelled. Tap Unlock to try again."', async () => {
        expect(await screen.findByRole('alert')).toHaveTextContent('Unlock cancelled. Tap Unlock to try again.');
      });

      And('the raw browser sentence and the w3.org link never appear', () => {
        expect(screen.queryByText(/timed out or was not allowed/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/w3\.org/i)).not.toBeInTheDocument();
      });

      And('"Unlock with your fingerprint" is still offered', () => {
        expect(screen.getByRole('button', { name: 'Unlock with your fingerprint' })).toBeInTheDocument();
      });
    },
  );
});

afterAll(() => {
  cleanup();
  removeMockAuthenticator();
  vi.unstubAllGlobals();
});
