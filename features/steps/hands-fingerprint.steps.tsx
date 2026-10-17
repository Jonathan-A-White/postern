// features/steps/hands-fingerprint.steps.tsx — runs features/hands-fingerprint.feature (mw-ev7oyy.41).
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey, Signature, Utils } from '@bsv/sdk';
import { StepRun } from '../../src/cockpit/HandsSteps';
import { db } from '../../src/data/db';
import { vaultRepo } from '../../src/data/repositories';
import { setKey, lock } from '../../src/services/keySession';
import { deriveAesKeyFromPrf, wrapKey } from '../../src/services/vault';
import { approvalMessage } from '../../src/model/hands';
import { handsStep } from '../../tests/support/cockpit-fixture';
import { installMockAuthenticator, removeMockAuthenticator, type MockAuthenticator } from '../../tests/support/webauthn-mock';
import type { HandsStep } from '../../src/model/hands';

const delivered: string[] = [];

vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  deliverOptions: (key: Uint8Array | null) => (key ? { key, mayorKey: 'mayor', direct: true } : null),
}));
vi.mock('../../src/services/deliver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/deliver')>()),
  deliverAction: vi.fn(async (action: unknown) => {
    delivered.push(JSON.stringify(action));
    return { txid: 'direct:' + '1'.repeat(64), channel: 'direct' as const };
  }),
}));

const BEAD = 'mw-h';
const HIM = PrivateKey.fromRandom();
const KEY = new Uint8Array(Utils.toArray(HIM.toHex(), 'hex'));
let step: HandsStep;
let authenticator: MockAuthenticator | undefined;

afterAll(() => {
  cleanup();
  removeMockAuthenticator();
  lock();
});

async function startedWith(mode: 'prf' | 'phrase'): Promise<void> {
  cleanup();
  delivered.length = 0;
  removeMockAuthenticator();
  await db.vault.clear();
  if (mode === 'prf') {
    authenticator = installMockAuthenticator({ prfSupported: true });
    const assertion = (await (authenticator.get as unknown as () => Promise<unknown>)()) as { getClientExtensionResults: () => { prf: { results: { first: ArrayBuffer } } } };
    authenticator.get.mockClear();
    const { ciphertext, iv } = await wrapKey(KEY, await deriveAesKeyFromPrf(assertion.getClientExtensionResults().prf.results.first));
    await vaultRepo.save({ mode: 'prf', ciphertext, iv, credentialId: new Uint8Array(16).buffer, publicKeyHex: HIM.toPublicKey().toString() });
  } else {
    authenticator = undefined;
    await vaultRepo.save({ mode: 'phrase', ciphertext: new ArrayBuffer(48), iv: new Uint8Array(12), salt: new Uint8Array(16), publicKeyHex: HIM.toPublicKey().toString() });
  }
  setKey(KEY);
  step = handsStep(BEAD, { id: 'linger', host: 'desktop', as: 'user', run: 'echo hi', way_back: '' });
  render(<StepRun bead={BEAD} step={step} />);
}

function isSignedByHim(raw: string): void {
  const action = JSON.parse(raw) as { action: string; bead: string; step: string; sha256: string; approved_at: number; sig: string };
  expect(action).toMatchObject({ action: 'run', bead: BEAD, step: 'linger', sha256: step.sha256 });
  expect(HIM.toPublicKey().verify(approvalMessage(action.sha256, action.approved_at), Signature.fromDER(action.sig, 'hex'))).toBe(true);
}

const feature = await loadFeature('features/hands-fingerprint.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('mw-ev7oyy.41 AC-1: one tap on Approve and run asks for the fingerprint, and a good one sends the signed approval', ({ Given, When, Then, And }) => {
    Given('a passkey-wrapped key, unlocked, and a step for his hands not yet run', () => startedWith('prf'));
    When('{string} is tapped', async (_c, name: string) => {
      await userEvent.click(screen.getByRole('button', { name }));
    });
    Then('the fingerprint is asked for once and there is no {string} box', async (_c, name: string) => {
      await waitFor(() => expect(delivered).toHaveLength(1));
      expect(authenticator?.get).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', { name })).toBeNull();
    });
    And('a run action for the step is delivered, signed by his key', () => {
      isSignedByHim(delivered[0]);
    });
  });

  Scenario('mw-ev7oyy.41 AC-2: a cancelled fingerprint sends nothing and says so on the step', ({ Given, And, When, Then }) => {
    Given('a passkey-wrapped key, unlocked, and a step for his hands not yet run', () => startedWith('prf'));
    And('the fingerprint will be cancelled', () => {
      authenticator?.get.mockRejectedValueOnce(new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'));
    });
    When('{string} is tapped', async (_c, name: string) => {
      await userEvent.click(screen.getByRole('button', { name }));
    });
    Then('nothing is delivered', async () => {
      await waitFor(() => expect(authenticator?.get).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(delivered).toHaveLength(0);
    });
    And('the step says {string}', async (_c, words: string) => {
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(words));
    });
    And('the step still offers {string}', async (_c, name: string) => {
      await waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled());
    });
  });

  Scenario('mw-ev7oyy.41 AC-3: a phrase-wrapped key still shows the Confirm and run box', ({ Given, When, Then, And }) => {
    Given('a phrase-wrapped key, unlocked, and a step for his hands not yet run', () => startedWith('phrase'));
    When('{string} is tapped', async (_c, name: string) => {
      await userEvent.click(screen.getByRole('button', { name }));
    });
    Then('the step offers {string} and nothing is delivered yet', async (_c, name: string) => {
      const box = await screen.findByRole('group', { name: 'Confirm' });
      expect(within(box).getByRole('button', { name })).toBeInTheDocument();
      expect(delivered).toHaveLength(0);
    });
    And('tapping {string} delivers a run action for the step', async (_c, name: string) => {
      await userEvent.click(screen.getByRole('button', { name }));
      await waitFor(() => expect(delivered).toHaveLength(1));
      isSignedByHim(delivered[0]);
    });
  });
});
