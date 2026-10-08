// mw-xhtcup.12: the door's Unlock screen (src/cockpit/Gate.tsx) shows the fingerprint button for a passkey
// key, says plainly that a dismissed prompt was cancelled, and asks for the recovery phrase where there is no
// passkey PRF. Its old guard (tests/unit/gate.test.tsx) went with the screen it tested.
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Unlock } from '../../src/cockpit/Gate';
import type { VaultRow } from '../../src/data/db';
import { createMnemonic, deriveAesKeyFromPrf, deriveMasterKey, publicKeyHexFromMasterKey, wrapKey } from '../../src/services/vault';
import { getKey, lock } from '../../src/services/keySession';
import { installMockAuthenticator, removeMockAuthenticator } from '../support/webauthn-mock';

// What tests/support/webauthn-mock.ts's authenticator returns for a successful PRF assertion.
const HARDWARE_SECRET = new Uint8Array(32).map((_, i) => i + 1);

async function prfVault(): Promise<VaultRow> {
  const masterKey = await deriveMasterKey(createMnemonic());
  const wrapped = await wrapKey(masterKey, await deriveAesKeyFromPrf(HARDWARE_SECRET.slice().buffer));
  return {
    id: 'vault',
    mode: 'prf',
    ciphertext: wrapped.ciphertext,
    iv: wrapped.iv,
    credentialId: crypto.getRandomValues(new Uint8Array(16)).buffer,
    publicKeyHex: publicKeyHexFromMasterKey(masterKey),
  };
}

function phraseVault(): VaultRow {
  return {
    id: 'vault',
    mode: 'phrase',
    ciphertext: new Uint8Array([1]).buffer,
    iv: new Uint8Array(12),
    salt: new Uint8Array(16),
    prfFallbackReason: 'webauthn-unavailable',
    publicKeyHex: '02'.padEnd(66, '0'),
  };
}

beforeEach(() => lock());
afterEach(() => {
  cleanup();
  removeMockAuthenticator();
  lock();
});
afterAll(() => cleanup());

describe('the Unlock screen', () => {
  it('offers "Unlock with your fingerprint" for a key kept behind a passkey', async () => {
    render(<Unlock vault={await prfVault()} />);
    expect(screen.getByRole('button', { name: 'Unlock with your fingerprint' })).toBeEnabled();
    expect(screen.queryByLabelText('Recovery phrase')).toBeNull();
  });

  it('says "Unlock cancelled. Tap Unlock to try again." when the fingerprint prompt is dismissed, and stays locked', async () => {
    installMockAuthenticator({ prfSupported: true, prfGetResult: 'not-allowed' });
    render(<Unlock vault={await prfVault()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Unlock with your fingerprint' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unlock cancelled. Tap Unlock to try again.');
    expect(screen.getByRole('alert').textContent).not.toMatch(/w3\.org|timed out/);
    expect(getKey()).toBeNull();
    expect(screen.getByRole('button', { name: 'Unlock with your fingerprint' })).toBeEnabled();
  });

  it('unlocks the key when the fingerprint is accepted', async () => {
    installMockAuthenticator({ prfSupported: true });
    render(<Unlock vault={await prfVault()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Unlock with your fingerprint' }));

    await expect.poll(() => getKey()).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('asks for the recovery phrase, not a fingerprint, where the key has no passkey', () => {
    render(<Unlock vault={phraseVault()} />);
    expect(screen.getByLabelText('Recovery phrase')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Unlock with your fingerprint' })).toBeNull();
  });
});
