// features/steps/shared-unlock-routing.steps.tsx — runs
// features/shared-unlock-routing.feature under vitest via @amiceli/vitest-cucumber.
// Unlike features/steps/key-session.steps.tsx (mw-tfne4.23), which renders each
// screen's component directly and so never exercises a real link click, this
// scenario renders <App/> once and drives every screen change with userEvent
// clicks and the browser's own Back button (src/router.ts) — proving the shared
// key session (src/services/keySession.ts) survives an actual navigation, not
// just a fresh component mount within the same test.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey, PublicKey, Utils } from '@bsv/sdk';
import { EncryptedMessage, chainConfig } from 'spell-forge-bsv';
import { App } from '../../src/App';
import { db } from '../../src/data/db';
import { vaultRepo } from '../../src/data/repositories';
import { addressForPublicKey } from '../../src/services/licence';
import { setMayorPublicKey } from '../../src/services/messages';
import {
  createMnemonic,
  deriveAesKeyFromPrf,
  deriveMasterKey,
  publicKeyHexFromMasterKey,
  wrapKey,
} from '../../src/services/vault';
import { lock } from '../../src/services/keySession';
import type { Snapshot } from '../../src/services/questions';
import { FakeChainProvider } from '../../tests/support/fake-chain-provider';
import { mintRecordTxHex } from '../../tests/support/nftgate-fixtures';
import { installMockAuthenticator, removeMockAuthenticator } from '../../tests/support/webauthn-mock';

let fakeProvider = new FakeChainProvider();

vi.mock('spell-forge-bsv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('spell-forge-bsv')>();
  return { ...actual, createChainProvider: () => fakeProvider };
});

const MAYOR_KEY = PrivateKey.fromHex('66'.repeat(32));
const MINT_TXID = 'e'.repeat(64);
// The same fixed value tests/support/webauthn-mock.ts's mocked authenticator
// returns for a successful PRF assertion. Building the vault fixture with it
// directly (instead of through KeyVault's generate-key UI) means the fixture's
// public key — and so the snapshot's encryption recipient — is known up front.
const HARDWARE_SECRET = new Uint8Array(32).map((_, i) => i + 1);

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

async function freshScreen(): Promise<void> {
  cleanup();
  removeMockAuthenticator();
  await db.vault.clear();
  await db.settings.clear();
  await db.snapshot.clear();
  lock();
  fakeProvider = new FakeChainProvider();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
}

/** Saves a real PRF vault whose fingerprint unlock recovers `masterKey` below —
 * so a successful unlock also decrypts the stubbed snapshot, encrypted to the
 * same key's public key. */
async function savePrfVault(): Promise<{ publicKeyHex: string }> {
  const masterKey = await deriveMasterKey(createMnemonic());
  const publicKeyHex = publicKeyHexFromMasterKey(masterKey);
  const aesKey = await deriveAesKeyFromPrf(HARDWARE_SECRET.slice().buffer);
  const wrapped = await wrapKey(masterKey, aesKey);
  await vaultRepo.save({
    mode: 'prf',
    ciphertext: wrapped.ciphertext,
    iv: wrapped.iv,
    credentialId: crypto.getRandomValues(new Uint8Array(16)).buffer,
    publicKeyHex,
  });
  return { publicKeyHex };
}

const SNAPSHOT: Snapshot = {
  written_at: new Date().toISOString(),
  epics: [
    {
      id: 'mw-alpha',
      title: 'Alpha project',
      priority: 'P0',
      status: 'in-progress',
      needs_you: [],
      landed: [{ id: 'mw-alpha.1', title: 'Landed thing', landed_at: '2026-09-24T10:00:00Z' }],
      working: [],
      closed_count: 0,
    },
  ],
};

const feature = await loadFeature('features/shared-unlock-routing.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario(
    'AC3: unlocking on the Projects screen carries through a project, a bead and the Send screen, until Lock',
    ({ Given, And, When, Then }) => {
      Given('a PRF-wrapped vault exists with one project and one landed item', async () => {
        await freshScreen();
        installMockAuthenticator({ prfSupported: true });
        const { publicKeyHex } = await savePrfVault();
        await setMayorPublicKey(MAYOR_KEY.toPublicKey().toString());
        const address = addressForPublicKey(publicKeyHex);
        fakeProvider.addTransaction(address, MINT_TXID, mintRecordTxHex(chainConfig.collectionId, address));
        vi.stubGlobal('fetch', snapshotFetchMock(encryptSnapshot(SNAPSHOT, publicKeyHex)));
      });

      And('the Projects screen is opened and unlocked with a fingerprint', async () => {
        window.history.pushState({}, '', '/?screen=projects');
        render(<App />);
        await userEvent.click(await screen.findByRole('button', { name: 'Unlock with your fingerprint' }));
        await screen.findByText('Alpha project');
      });

      When('the project is opened by tapping its row', async () => {
        await userEvent.click(screen.getByRole('link', { name: /Alpha project/ }));
      });

      Then('the project screen shows no fingerprint prompt', async () => {
        expect(await screen.findByRole('heading', { name: 'Alpha project' })).toBeInTheDocument();
        expect(screen.queryByText('The key is locked.')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Unlock with your fingerprint' })).not.toBeInTheDocument();
      });

      When('the landed item is opened by tapping its row', async () => {
        await userEvent.click(screen.getByRole('link', { name: /Landed thing/ }));
      });

      Then('the bead screen shows no fingerprint prompt', async () => {
        expect(await screen.findByText('Landed thing')).toBeInTheDocument();
        expect(screen.queryByText('The key is locked.')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Unlock with your fingerprint' })).not.toBeInTheDocument();
      });

      When('the browser\'s Back button returns to the root and "Send a message" is opened', async () => {
        window.history.go(-3); // bead -> project -> projects -> root
        await waitFor(() => expect(window.location.search).toBe(''));
        await userEvent.click(await screen.findByRole('link', { name: 'Send a message' }));
      });

      Then('the Send screen shows no fingerprint prompt', async () => {
        expect(await screen.findByText("Mayor's public key:", { exact: false })).toBeInTheDocument();
        expect(screen.queryByText('The key is locked.')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Unlock with your fingerprint' })).not.toBeInTheDocument();
      });

      When('"Lock" is tapped on the Send screen', async () => {
        await userEvent.click(screen.getByRole('button', { name: 'Lock' }));
        expect(await screen.findByText('The key is locked.')).toBeInTheDocument();
      });

      And('the browser\'s Back button returns to the root and "Send a message" is opened again', async () => {
        window.history.go(-1); // compose -> root
        await waitFor(() => expect(window.location.search).toBe(''));
        await userEvent.click(await screen.findByRole('link', { name: 'Send a message' }));
      });

      Then('the Send screen offers to unlock with your fingerprint', async () => {
        expect(await screen.findByRole('button', { name: 'Unlock with your fingerprint' })).toBeInTheDocument();
      });
    },
  );

  Scenario(
    'AC3 (mw-tfne4.29): tapping the Projects screen\'s own "Back" link to the home screen keeps the shared unlock',
    ({ Given, And, When, Then }) => {
      Given('a PRF-wrapped vault exists with one project and one landed item', async () => {
        await freshScreen();
        installMockAuthenticator({ prfSupported: true });
        const { publicKeyHex } = await savePrfVault();
        await setMayorPublicKey(MAYOR_KEY.toPublicKey().toString());
        const address = addressForPublicKey(publicKeyHex);
        fakeProvider.addTransaction(address, MINT_TXID, mintRecordTxHex(chainConfig.collectionId, address));
        vi.stubGlobal('fetch', snapshotFetchMock(encryptSnapshot(SNAPSHOT, publicKeyHex)));
      });

      And('the Projects screen is opened and unlocked with a fingerprint', async () => {
        window.history.pushState({}, '', '/?screen=projects');
        render(<App />);
        await userEvent.click(await screen.findByRole('button', { name: 'Unlock with your fingerprint' }));
        await screen.findByText('Alpha project');
      });

      When('the "Back" link is tapped to return to the home screen', async () => {
        await userEvent.click(screen.getByRole('link', { name: 'Back' }));
        await waitFor(() => expect(window.location.search).toBe(''));
      });

      And('"Send a message" is opened', async () => {
        await userEvent.click(await screen.findByRole('link', { name: 'Send a message' }));
      });

      Then('the Send screen shows no fingerprint prompt', async () => {
        expect(await screen.findByText("Mayor's public key:", { exact: false })).toBeInTheDocument();
        expect(screen.queryByText('The key is locked.')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Unlock with your fingerprint' })).not.toBeInTheDocument();
      });
    },
  );
});

afterAll(() => {
  cleanup();
  removeMockAuthenticator();
  lock();
  vi.unstubAllGlobals();
});
