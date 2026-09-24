// tests/support/webauthn-mock.ts — a fake platform authenticator for jsdom, which
// implements neither the Credential Management API nor the PRF extension. Tests
// install this to simulate a phone with a fingerprint-unlocked passkey; leaving it
// uninstalled simulates a phone/browser with no WebAuthn support at all (the
// feature-detected fallback path).
import { vi } from 'vitest';

export interface MockAuthenticator {
  create: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
}

// A fixed 32-byte "hardware secret" standing in for what a real authenticator's
// PRF evaluation would return; using a fixed value keeps repeated unlocks of the
// same mocked passkey deterministic, the way a real one would be for a fixed salt.
const HARDWARE_SECRET = new Uint8Array(32).map((_, i) => i + 1);

export interface MockAuthenticatorOptions {
  prfSupported: boolean;
  // What the assertion (get()) ceremony yields once it runs. Defaults follow the
  // original two-state behaviour: a PRF-supporting authenticator yields a secret,
  // a non-supporting one refuses the assertion outright. 'empty' simulates an
  // authenticator that reports PRF support at creation but evaluates to nothing.
  prfGetResult?: 'secret' | 'empty' | 'throws';
}

export function installMockAuthenticator({
  prfSupported,
  prfGetResult = prfSupported ? 'secret' : 'throws',
}: MockAuthenticatorOptions): MockAuthenticator {
  let credentialId: ArrayBuffer | null = null;

  const create = vi.fn(async () => {
    credentialId = crypto.getRandomValues(new Uint8Array(16)).buffer;
    return {
      rawId: credentialId,
      getClientExtensionResults: () => (prfSupported ? { prf: { enabled: true } } : {}),
    };
  });

  const get = vi.fn(async () => {
    if (prfGetResult === 'throws') {
      throw new Error('mock authenticator: PRF is not supported');
    }
    return {
      rawId: credentialId,
      getClientExtensionResults: () =>
        prfGetResult === 'empty'
          ? { prf: { results: {} } }
          : { prf: { results: { first: HARDWARE_SECRET.slice().buffer } } },
    };
  });

  Object.defineProperty(window, 'PublicKeyCredential', {
    value: function PublicKeyCredential() {},
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, 'credentials', {
    value: { create, get },
    configurable: true,
    writable: true,
  });

  return { create, get };
}

export function removeMockAuthenticator(): void {
  Object.defineProperty(window, 'PublicKeyCredential', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, 'credentials', {
    value: undefined,
    configurable: true,
    writable: true,
  });
}
