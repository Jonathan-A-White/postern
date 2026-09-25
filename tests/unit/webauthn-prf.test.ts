import { describe, it, expect, afterEach } from 'vitest';
import { isWebAuthnAvailable, createPrfPasskey, getPrfSecret, describeUnlockError } from '../../src/services/webauthnPrf';
import { installMockAuthenticator, removeMockAuthenticator } from '../support/webauthn-mock';

describe('webauthnPrf', () => {
  afterEach(() => {
    removeMockAuthenticator();
  });

  it('reports WebAuthn unavailable when there is no platform authenticator', () => {
    expect(isWebAuthnAvailable()).toBe(false);
  });

  it('reports WebAuthn available once a platform authenticator is present', () => {
    installMockAuthenticator({ prfSupported: true });
    expect(isWebAuthnAvailable()).toBe(true);
  });

  it('creates a passkey and reports PRF support when the authenticator supports it', async () => {
    installMockAuthenticator({ prfSupported: true });
    const passkey = await createPrfPasskey('governor', 'The Governor');
    expect(passkey.prfSupported).toBe(true);
    expect(passkey.credentialId).toBeInstanceOf(ArrayBuffer);
  });

  it('creates a passkey and reports no PRF support when the authenticator lacks it', async () => {
    installMockAuthenticator({ prfSupported: false });
    const passkey = await createPrfPasskey('governor', 'The Governor');
    expect(passkey.prfSupported).toBe(false);
  });

  it('fetches the same PRF secret twice for the same passkey', async () => {
    installMockAuthenticator({ prfSupported: true });
    const passkey = await createPrfPasskey('governor', 'The Governor');
    const first = await getPrfSecret(passkey.credentialId);
    const second = await getPrfSecret(passkey.credentialId);
    expect(first).not.toBeNull();
    expect(new Uint8Array(first!)).toEqual(new Uint8Array(second!));
  });

  it('requests a discoverable, user-verified credential so Android stores it as a PRF-capable passkey', async () => {
    const authenticator = installMockAuthenticator({ prfSupported: true });
    await createPrfPasskey('governor', 'The Governor');
    const options = authenticator.create.mock.calls[0][0].publicKey;
    expect(options.authenticatorSelection.residentKey).toBe('required');
    expect(options.authenticatorSelection.userVerification).toBe('required');
  });
});

describe('describeUnlockError', () => {
  it('mw-tfne4.18 AC1: maps a dismissed or timed-out prompt (NotAllowedError) to a plain retry message', () => {
    const err = new DOMException(
      'The operation either timed out or was not allowed. See: https://www.w3.org/TR/webauthn-2/#sctn-privacy-considerations-client.',
      'NotAllowedError',
    );
    expect(describeUnlockError(err)).toBe('Unlock cancelled. Tap Unlock to try again.');
  });

  it('mw-tfne4.18 AC1: maps an unsupported authenticator (NotSupportedError) to a one-line message naming the phrase', () => {
    const err = new DOMException('PRF is not supported on this authenticator.', 'NotSupportedError');
    const message = describeUnlockError(err);
    expect(message).not.toMatch(/\n/);
    expect(message.toLowerCase()).toContain('recovery phrase');
  });

  it('mw-tfne4.18 AC1: keeps any other error message but strips any URL from it', () => {
    const err = new Error('The passkey did not return a PRF secret. See: https://example.com/docs.');
    expect(describeUnlockError(err)).toBe('The passkey did not return a PRF secret.');
    expect(describeUnlockError(err)).not.toMatch(/https?:\/\//);
  });

  it('mw-tfne4.18 AC1: leaves an ordinary message with no URL untouched', () => {
    const err = new Error('No passkey is registered for this key.');
    expect(describeUnlockError(err)).toBe('No passkey is registered for this key.');
  });
});
