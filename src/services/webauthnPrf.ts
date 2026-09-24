// src/services/webauthnPrf.ts — wraps the WebAuthn PRF extension: a platform
// passkey (fingerprint/face unlock) that, given a fixed salt, deterministically
// returns the same secret on every unlock. That secret becomes the AES-GCM
// wrapping key for the vault in src/services/vault.ts.
//
// The PRF extension isn't reliably evaluable during registration on every
// authenticator (the spec notes some can't compute outputs until they've been
// used once), so registration only detects support; a separate assertion
// ceremony evaluates the actual secret. MDN's WebAuthn extensions reference
// says as much explicitly: "evaluating a PRF when creating a credential may
// not be supported... You could still try evaluating the PRF in an
// assertion" — so a false/absent `prf.enabled` here must not by itself rule
// PRF out; only a failed or empty get() does (see PrfFallbackReason, KeyVault.tsx).
const PRF_EVAL_SALT = new TextEncoder().encode('postern-vault-prf-v1');

export interface PrfPasskey {
  credentialId: ArrayBuffer;
  prfSupported: boolean;
}

export function isWebAuthnAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.credentials?.create === 'function'
  );
}

export async function createPrfPasskey(userId: string, userName: string): Promise<PrfPasskey> {
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Postern' },
      user: {
        id: new TextEncoder().encode(userId),
        name: userName,
        displayName: userName,
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      // residentKey 'required' asks for a discoverable credential. Without it,
      // Chrome on Android may create a device-bound credential rather than a
      // Google Password Manager passkey — and PRF support on Android is
      // documented for Google Password Manager passkeys, not device-bound
      // credentials, which is why an otherwise-successful ceremony can come
      // back with no usable PRF secret.
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'required',
        userVerification: 'required',
      },
      extensions: { prf: {} },
    },
  })) as PublicKeyCredential;

  const results = credential.getClientExtensionResults() as { prf?: { enabled?: boolean } };

  return {
    credentialId: credential.rawId,
    prfSupported: results.prf?.enabled === true,
  };
}

export async function getPrfSecret(credentialId: ArrayBuffer): Promise<ArrayBuffer | null> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ id: credentialId, type: 'public-key' }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: PRF_EVAL_SALT } } },
    },
  })) as PublicKeyCredential;

  const results = assertion.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };

  return results.prf?.results?.first ?? null;
}
