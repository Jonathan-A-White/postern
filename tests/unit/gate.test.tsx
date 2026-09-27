import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PrivateKey } from '@bsv/sdk';
import { chainConfig } from 'spell-forge-bsv';
import { Gate } from '../../src/gate';
import { db } from '../../src/data/db';
import { vaultRepo, messagesRepo } from '../../src/data/repositories';
import { addressForPublicKey, checkLicence, setMintPending } from '../../src/services/licence';
import { lock, setKey } from '../../src/services/keySession';
import { createMnemonic, deriveAesKeyFromPrf, deriveMasterKey, publicKeyHexFromMasterKey, wrapKey } from '../../src/services/vault';
import { FakeChainProvider } from '../support/fake-chain-provider';
import { installMockAuthenticator, removeMockAuthenticator } from '../support/webauthn-mock';
import { challengeResponse, isChallengeRequest } from '../support/challenge-fetch';
import { mintRecordTxHex } from '../support/nftgate-fixtures';

let fakeProvider = new FakeChainProvider();

vi.mock('spell-forge-bsv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('spell-forge-bsv')>();
  return { ...actual, createChainProvider: () => fakeProvider };
});

const TEST_KEY = PrivateKey.fromHex('44'.repeat(32));
const TEST_PUBLIC_KEY_HEX = TEST_KEY.toPublicKey().toString();

// The same fixed value tests/support/webauthn-mock.ts's mocked authenticator
// returns for a successful PRF assertion.
const HARDWARE_SECRET = new Uint8Array(32).map((_, i) => i + 1);

beforeEach(async () => {
  fakeProvider = new FakeChainProvider();
  await db.vault.clear();
  await db.settings.clear();
  await db.messages.clear();
});

async function saveTestVault(): Promise<void> {
  await vaultRepo.save({
    mode: 'phrase',
    ciphertext: new Uint8Array([1]).buffer,
    iv: new Uint8Array(12),
    salt: new Uint8Array(16),
    prfFallbackReason: 'webauthn-unavailable',
    publicKeyHex: TEST_PUBLIC_KEY_HEX,
  });
}

/** Saves a real PRF vault whose fingerprint unlock recovers the same master key
 * used to derive `publicKeyHex`, and grants that key a licence on the fake chain —
 * the fixture handleNotifyMe's tests need to reach the "licensed" screen and then
 * exercise a real unlock. */
async function saveLicensedPrfVault(): Promise<{ publicKeyHex: string; masterKey: Uint8Array }> {
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
  const address = addressForPublicKey(publicKeyHex);
  fakeProvider.addTransaction(address, 'a'.repeat(64), mintRecordTxHex(chainConfig.collectionId, address));
  return { publicKeyHex, masterKey };
}

function installNotificationMock(permission: NotificationPermission): void {
  Object.defineProperty(window, 'Notification', {
    value: { requestPermission: vi.fn(async () => permission) },
    configurable: true,
    writable: true,
  });
}

function installServiceWorkerMock(): void {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: {
      ready: Promise.resolve({
        pushManager: {
          subscribe: vi.fn(async () => ({
            toJSON: () => ({ endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } }),
          })),
        },
      }),
    },
    configurable: true,
    writable: true,
  });
}

function installFetchMock(): { authHeaders: string[]; subscribeBody: unknown } {
  const state = { authHeaders: [] as string[], subscribeBody: null as unknown };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (isChallengeRequest(url)) return challengeResponse();
      const auth = new Headers(init?.headers).get('Authorization');
      if (auth) state.authHeaders.push(auth);
      if (url.endsWith('/push/vapid-public-key')) {
        if (!auth) return new Response(JSON.stringify({ error: 'no licence held' }), { status: 401 });
        return new Response(JSON.stringify({ publicKey: 'server-vapid-public-key' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/push/subscribe')) {
        if (!auth) return new Response(JSON.stringify({ error: 'no licence held' }), { status: 401 });
        state.subscribeBody = JSON.parse(String(init?.body));
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  return state;
}

describe('Gate', () => {
  it('renders the app name and the locked message', () => {
    render(<Gate />);
    expect(screen.getByText('The gate is locked')).toBeInTheDocument();
    expect(screen.getByText('Postern')).toBeInTheDocument();
  });

  it('renders the app version', () => {
    render(<Gate />);
    expect(screen.getByText(__APP_VERSION__, { exact: false })).toBeInTheDocument();
  });

  it('offers a link to mint a licence when a key has no licence yet', async () => {
    await saveTestVault();

    render(<Gate />);
    const link = await screen.findByRole('link', { name: 'Mint a licence' });
    expect(link).toHaveAttribute('href', '?screen=key');
  });

  it('shows a checking state on Check again until the answer lands', async () => {
    await saveTestVault();
    render(<Gate />);
    await screen.findByRole('button', { name: 'Check again' });

    let resolvePause: () => void = () => {};
    fakeProvider.pauseUntil = new Promise((resolve) => {
      resolvePause = resolve;
    });

    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));

    expect(screen.getByRole('button', { name: 'Checking...' })).toBeDisabled();

    fakeProvider.pauseUntil = null;
    resolvePause();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled());
  });

  it('shows the mint as pending instead of "No licence found" while it is unindexed', async () => {
    await saveTestVault();
    await setMintPending('c'.repeat(64));

    render(<Gate />);

    expect(
      await screen.findByText('Your licence mint is broadcast; the chain can take a minute to show it'),
    ).toBeInTheDocument();
    expect(screen.queryByText('No licence found')).not.toBeInTheDocument();
  });

  it('does not trust a cached no-licence answer while a mint is pending and the chain is unreachable', async () => {
    await saveTestVault();
    await checkLicence(TEST_PUBLIC_KEY_HEX, fakeProvider); // caches held:false
    await setMintPending('d'.repeat(64));
    fakeProvider.offline = true;

    render(<Gate />);

    expect(
      await screen.findByText('Your licence mint is broadcast; the chain can take a minute to show it'),
    ).toBeInTheDocument();
    expect(screen.queryByText('No licence found')).not.toBeInTheDocument();
  });

  it('shows the unread count on the Inbox link and it drops once the message is read (mw-tfne4.35 AC2)', async () => {
    await saveLicensedPrfVault();
    const messageId = 'a'.repeat(64) + ':0';
    await messagesRepo.put({
      id: messageId,
      txid: 'a'.repeat(64),
      vout: 0,
      seq: 1,
      class: 'message',
      to: 'to',
      from: 'from',
      ts: 100,
      ciphertext: 'unused',
      plaintext: 'hello',
      direction: 'received',
      read: false,
    });

    const { unmount } = render(<Gate />);
    await screen.findByText('Licensed');
    expect(screen.getByTestId('unread-count')).toHaveTextContent('(1)');
    unmount();

    await messagesRepo.markRead(messageId);

    render(<Gate />);
    await screen.findByText('Licensed');
    expect(screen.queryByTestId('unread-count')).not.toBeInTheDocument();
  });
});

describe('Notify me', () => {
  afterEach(() => {
    removeMockAuthenticator();
    vi.unstubAllGlobals();
    lock();
  });

  it('unlocks the key first when the session has lapsed, then subscribes (mw-tfne4.32 AC1)', async () => {
    await saveLicensedPrfVault();
    lock(); // no cached session key
    const authenticator = installMockAuthenticator({ prfSupported: true });
    installNotificationMock('granted');
    installServiceWorkerMock();
    const fetchState = installFetchMock();

    render(<Gate />);
    await screen.findByText('Licensed');

    await userEvent.click(screen.getByRole('button', { name: 'Notify me' }));

    expect(await screen.findByText('Notifications enabled.')).toBeInTheDocument();
    expect(authenticator.get).toHaveBeenCalledTimes(1);
    expect(fetchState.subscribeBody).not.toBeNull();
    expect(fetchState.authHeaders.length).toBeGreaterThan(0);
    for (const header of fetchState.authHeaders) {
      expect(header).toMatch(/^Postern [0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    }
  });

  it('subscribes straight away when the session is already unlocked (mw-tfne4.32 AC2)', async () => {
    const { masterKey } = await saveLicensedPrfVault();
    const authenticator = installMockAuthenticator({ prfSupported: true });
    installNotificationMock('granted');
    installServiceWorkerMock();
    const fetchState = installFetchMock();

    render(<Gate />);
    await screen.findByText('Licensed');

    setKey(masterKey);

    await userEvent.click(screen.getByRole('button', { name: 'Notify me' }));

    expect(await screen.findByText('Notifications enabled.')).toBeInTheDocument();
    expect(authenticator.get).not.toHaveBeenCalled();
    expect(fetchState.subscribeBody).not.toBeNull();
  });

  it('shows the unlock error, never "Licence required", when the fingerprint prompt is declined (mw-tfne4.32 AC3)', async () => {
    await saveLicensedPrfVault();
    lock();
    installMockAuthenticator({ prfSupported: true, prfGetResult: 'not-allowed' });
    installNotificationMock('granted');
    installServiceWorkerMock();
    const fetchState = installFetchMock();

    render(<Gate />);
    await screen.findByText('Licensed');

    await userEvent.click(screen.getByRole('button', { name: 'Notify me' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unlock cancelled. Tap Unlock to try again.');
    expect(screen.queryByText('Licence required')).not.toBeInTheDocument();
    expect(fetchState.subscribeBody).toBeNull();
  });
});
