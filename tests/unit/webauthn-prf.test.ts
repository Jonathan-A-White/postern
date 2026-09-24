import { describe, it, expect, afterEach } from 'vitest';
import { isWebAuthnAvailable, createPrfPasskey, getPrfSecret } from '../../src/services/webauthnPrf';
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
