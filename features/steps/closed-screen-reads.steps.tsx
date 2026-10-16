// features/steps/closed-screen-reads.steps.tsx — runs features/closed-screen-reads.feature under vitest via
// @amiceli/vitest-cucumber (mw-ev7oyy.21): a read the Key screen started that answers after the screen has
// closed, and after the page is torn down, sets nothing. The chain and /api/me are held on deferreds the
// scenario settles by hand; tests/support/after-teardown.ts takes `window` away as vitest's teardown does.
// See gate.steps.tsx for why dont-cleanup-after-each is imported and cleanup() called by hand.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey } from '@bsv/sdk';
import { KeyVault } from '../../src/key';
import { chain, setChain, type Chain, type LicenceStatus } from '../../src/chain';
import { db } from '../../src/data/db';
import { vaultRepo } from '../../src/data/repositories';
import { lock, setKey } from '../../src/services/keySession';
import { COCKPIT_COLLECTION } from '../../src/services/collections';
import type { Me } from '../../src/services/me';
import type { IssuedLicenceEntry } from '../../src/services/issue';
import { deferred, settleAfterTeardown } from '../../tests/support/after-teardown';

const services = vi.hoisted(() => ({ fetchMe: vi.fn() }));

vi.mock('../../src/services/me', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/me')>()),
  fetchMe: services.fetchMe,
}));

const feature = await loadFeature('features/closed-screen-reads.feature');

const ME = PrivateKey.fromHex('11'.repeat(32));
const MASTER = new Uint8Array(ME.toArray('be', 32));
const MY_PUBLIC_KEY = ME.toPublicKey().toString();

let previousChain: Chain | undefined;

// What was raised and the line of src/ that raised it, e.g. 'ReferenceError: window is not defined at src/key/KeyVault.tsx:201:23'.
function where(reason: unknown): string {
  const frame = (reason instanceof Error ? (reason.stack ?? '') : '').split('\n').find((line) => line.includes('/src/'));
  return `${String(reason)}${frame ? ` at ${frame.slice(frame.indexOf('src/')).replace(/\)$/, '')}` : ''}`;
}

afterAll(() => {
  cleanup();
  if (previousChain) setChain(previousChain);
  lock();
});

describeFeature(feature, ({ Scenario }) => {
  Scenario('AC1: the Key screen closed while the chain is still answering sets nothing afterwards', ({ Given, When, And, Then }) => {
    const balance = deferred<number>();
    const cachedLicence = deferred<LicenceStatus | undefined>();
    const me = deferred<Me>();
    const issuerBalance = deferred<number>();
    const issued = deferred<IssuedLicenceEntry[]>();
    let raised: unknown[] = [];

    Given('my key is unlocked and every read the Key screen makes is still on its way', async () => {
      cleanup();
      await db.vault.clear();
      await db.settings.clear();
      lock();
      await vaultRepo.save({ mode: 'phrase', ciphertext: new ArrayBuffer(1), iv: new Uint8Array(12), publicKeyHex: MY_PUBLIC_KEY });
      setKey(MASTER);
      services.fetchMe.mockReturnValue(me.promise);
      previousChain = setChain({
        ...chain,
        balance: () => balance.promise,
        cachedLicenceStatus: () => cachedLicence.promise,
        issuerBalance: () => issuerBalance.promise,
        issuedLicences: () => issued.promise,
      });
    });
    When('the key screen is opened', async () => {
      render(<KeyVault />);
      await screen.findByText('Key unlocked');
    });
    And('it is closed before the reads answer', () => {
      cleanup();
      expect(screen.queryByText('Key unlocked')).not.toBeInTheDocument();
    });
    And('the page is torn down before the balance read fails and every other read answers', async () => {
      raised = await settleAfterTeardown(() => {
        balance.reject(new Error('WhatsOnChain could not be reached'));
        cachedLicence.resolve({ held: true, outpoint: { txid: 'a'.repeat(64), vout: 0 }, collection: COCKPIT_COLLECTION, checkedAt: '2026-10-15T00:00:00Z' });
        me.resolve({ pubkey: MY_PUBLIC_KEY, mayor: '', network: 'testnet', features: ['me'], collections: [{ name: 'postern' }] });
        issuerBalance.resolve(50_000);
        issued.resolve([]);
      });
    });
    Then('nothing tried to update the closed screen', () => {
      expect(raised.map(where)).toEqual([]);
    });
  });
});
