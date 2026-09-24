import { Fragment, useEffect, useState } from 'react';
import { vaultRepo } from '../data/repositories';
import type { PrfFallbackReason, VaultRow } from '../data/db';
import { isWebAuthnAvailable, createPrfPasskey, getPrfSecret } from '../services/webauthnPrf';
import {
  createMnemonic,
  isValidMnemonic,
  findInvalidWords,
  deriveMasterKey,
  deriveAesKeyFromPrf,
  deriveAesKeyFromPhrase,
  publicKeyHexFromMasterKey,
  wrapKey,
  unwrapKey,
} from '../services/vault';

type CopyStatus = 'idle' | 'copied' | 'unavailable';

type Screen =
  | { name: 'loading' }
  | { name: 'empty' }
  | { name: 'reveal'; mnemonic: string; key: Uint8Array }
  | { name: 'restore' }
  | { name: 'locked'; vault: VaultRow }
  | { name: 'unlocked'; key: Uint8Array; prfFallbackReason?: PrfFallbackReason };

// One clause per PrfFallbackReason, worded to read naturally both as the tail
// of "Fingerprint unlock was not used: ..." (the reveal step's confirmation)
// and inside "...wrapped by the recovery phrase (...)" (the locked screen) —
// the same case named in two places (mw-f758y.16).
const PRF_FALLBACK_CLAUSES: Record<PrfFallbackReason, string> = {
  'webauthn-unavailable': 'fingerprint unlock is not available on this phone or browser',
  'passkey-created-without-prf': 'the passkey was created but reports no PRF support',
  'prf-secret-empty': 'the passkey did not return a usable fingerprint secret',
};

function describeFallbackClause(reason: PrfFallbackReason | undefined): string {
  return reason ? PRF_FALLBACK_CLAUSES[reason] : 'fingerprint unlock was not available when it was created';
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function describeInvalidWords(words: string[]): string {
  const quoted = words.map((word) => `'${word}'`).join(', ');
  return words.length === 1
    ? `${quoted} is not a word of the recovery list.`
    : `${quoted} are not words of the recovery list.`;
}

async function storePhraseWrapped(
  mnemonic: string,
  key: Uint8Array,
  prfFallbackReason: PrfFallbackReason,
): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const aesKey = await deriveAesKeyFromPhrase(mnemonic, salt);
  const wrapped = await wrapKey(key, aesKey);
  await vaultRepo.save({
    mode: 'phrase',
    ciphertext: wrapped.ciphertext,
    iv: wrapped.iv,
    salt,
    prfFallbackReason,
    publicKeyHex: publicKeyHexFromMasterKey(key),
  });
}

// Stores the key, wrapped by a fingerprint passkey when one is usable and by
// the recovery phrase otherwise. Returns the reason for a phrase fallback (or
// null when PRF was used) so the caller can name the case on screen.
//
// create()'s prf.enabled is not trusted on its own — some authenticators only
// report PRF support once it's actually evaluated in a get() ceremony (MDN;
// see the comment on createPrfPasskey) — so a get() is always attempted once
// WebAuthn is available, regardless of what create() reported.
async function storeKey(mnemonic: string, key: Uint8Array): Promise<PrfFallbackReason | null> {
  if (!isWebAuthnAvailable()) {
    await storePhraseWrapped(mnemonic, key, 'webauthn-unavailable');
    return 'webauthn-unavailable';
  }

  const passkey = await createPrfPasskey('postern-governor', 'The Governor');
  let prfSecret: ArrayBuffer | null = null;
  try {
    prfSecret = await getPrfSecret(passkey.credentialId);
  } catch {
    prfSecret = null;
  }

  if (prfSecret) {
    const aesKey = await deriveAesKeyFromPrf(prfSecret);
    const wrapped = await wrapKey(key, aesKey);
    await vaultRepo.save({
      mode: 'prf',
      ciphertext: wrapped.ciphertext,
      iv: wrapped.iv,
      credentialId: passkey.credentialId,
      publicKeyHex: publicKeyHexFromMasterKey(key),
    });
    return null;
  }

  const reason: PrfFallbackReason = passkey.prfSupported ? 'prf-secret-empty' : 'passkey-created-without-prf';
  await storePhraseWrapped(mnemonic, key, reason);
  return reason;
}

export function KeyVault() {
  const [screen, setScreen] = useState<Screen>({ name: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const [phraseInput, setPhraseInput] = useState('');
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');

  useEffect(() => {
    void vaultRepo.get().then((vault) => {
      setScreen(vault ? { name: 'locked', vault } : { name: 'empty' });
    });
  }, []);

  async function handleGenerate() {
    const mnemonic = createMnemonic();
    const key = await deriveMasterKey(mnemonic);
    setCopyStatus('idle');
    setScreen({ name: 'reveal', mnemonic, key });
  }

  async function handleCopyWords(mnemonic: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API not available');
      await navigator.clipboard.writeText(mnemonic);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 3000);
    } catch {
      setCopyStatus('unavailable');
    }
  }

  async function handleConfirmWritten(mnemonic: string, key: Uint8Array) {
    setError(null);
    try {
      const prfFallbackReason = await storeKey(mnemonic, key);
      setScreen({ name: 'unlocked', key, prfFallbackReason: prfFallbackReason ?? undefined });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleRestore() {
    setError(null);
    const invalidWords = findInvalidWords(phraseInput);
    if (invalidWords.length > 0) {
      setError(describeInvalidWords(invalidWords));
      return;
    }
    if (!isValidMnemonic(phraseInput)) {
      setError('That is not a valid recovery phrase.');
      return;
    }
    try {
      const key = await deriveMasterKey(phraseInput);
      const prfFallbackReason = await storeKey(phraseInput, key);
      setPhraseInput('');
      setScreen({ name: 'unlocked', key, prfFallbackReason: prfFallbackReason ?? undefined });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleUnlockWithFingerprint(vault: VaultRow) {
    setError(null);
    try {
      if (!vault.credentialId) throw new Error('No passkey is registered for this key.');
      const prfSecret = await getPrfSecret(vault.credentialId);
      if (!prfSecret) throw new Error('The passkey did not return a PRF secret.');
      const aesKey = await deriveAesKeyFromPrf(prfSecret);
      const key = await unwrapKey({ ciphertext: vault.ciphertext, iv: vault.iv }, aesKey);
      setScreen({ name: 'unlocked', key });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleUnlockWithPhrase(vault: VaultRow) {
    setError(null);
    const invalidWords = findInvalidWords(phraseInput);
    if (invalidWords.length > 0) {
      setError(describeInvalidWords(invalidWords));
      return;
    }
    try {
      if (!vault.salt) throw new Error('No recovery salt is stored for this key.');
      const aesKey = await deriveAesKeyFromPhrase(phraseInput, vault.salt);
      const key = await unwrapKey({ ciphertext: vault.ciphertext, iv: vault.iv }, aesKey);
      setPhraseInput('');
      setScreen({ name: 'unlocked', key });
    } catch {
      setError('That recovery phrase did not unlock the key.');
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-900 p-6 text-slate-200">
      <h1 className="text-2xl font-semibold">The key vault</h1>

      {error && (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      )}

      {screen.name === 'loading' && <p>Checking for a saved key…</p>}

      {screen.name === 'empty' && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-slate-400">
            Fingerprint unlock on this device: {isWebAuthnAvailable() ? 'available' : 'not available'}
          </p>
          <button
            className="rounded bg-slate-700 px-4 py-2"
            onClick={() => void handleGenerate()}
          >
            Generate a new key
          </button>
          <button
            className="rounded bg-slate-700 px-4 py-2"
            onClick={() => setScreen({ name: 'restore' })}
          >
            Restore from a phrase
          </button>
        </div>
      )}

      {screen.name === 'reveal' && (
        <div className="flex flex-col gap-2">
          <p>Write down these 12 words. This is the only time they will be shown.</p>
          <p data-testid="mnemonic-words" className="select-all rounded bg-slate-800 p-3 font-mono">
            {screen.mnemonic.split(' ').map((word, i, words) => (
              <Fragment key={i}>
                <span data-testid="mnemonic-word">{word}</span>
                {i < words.length - 1 ? ' ' : ''}
              </Fragment>
            ))}
          </p>
          <button
            className="rounded bg-slate-700 px-4 py-2"
            onClick={() => void handleCopyWords(screen.mnemonic)}
          >
            {copyStatus === 'copied' ? 'Copied' : 'Copy the twelve words'}
          </button>
          {copyStatus === 'unavailable' && <p>Copy is not available here: select the words by hand</p>}
          <button
            className="rounded bg-slate-700 px-4 py-2"
            onClick={() => void handleConfirmWritten(screen.mnemonic, screen.key)}
          >
            I&apos;ve written it down
          </button>
        </div>
      )}

      {screen.name === 'restore' && (
        <div className="flex flex-col gap-2">
          <label htmlFor="recovery-phrase">Recovery phrase</label>
          <textarea
            id="recovery-phrase"
            value={phraseInput}
            onChange={(e) => setPhraseInput(e.target.value)}
          />
          <button className="rounded bg-slate-700 px-4 py-2" onClick={() => void handleRestore()}>
            Restore
          </button>
        </div>
      )}

      {screen.name === 'locked' && screen.vault.mode === 'prf' && (
        <div className="flex flex-col gap-2">
          <p>The key is locked.</p>
          <button
            className="rounded bg-slate-700 px-4 py-2"
            onClick={() => void handleUnlockWithFingerprint(screen.vault)}
          >
            Unlock with your fingerprint
          </button>
        </div>
      )}

      {screen.name === 'locked' && screen.vault.mode === 'phrase' && (
        <div className="flex flex-col gap-2">
          <p>The key is locked.</p>
          <p>
            This phone holds your key wrapped by the recovery phrase (
            {describeFallbackClause(screen.vault.prfFallbackReason)}): type the twelve words
          </p>
          <label htmlFor="recovery-phrase">Recovery phrase</label>
          <textarea
            id="recovery-phrase"
            value={phraseInput}
            onChange={(e) => setPhraseInput(e.target.value)}
          />
          <button
            className="rounded bg-slate-700 px-4 py-2"
            onClick={() => void handleUnlockWithPhrase(screen.vault)}
          >
            Unlock
          </button>
        </div>
      )}

      {screen.name === 'unlocked' && (
        <div className="flex flex-col gap-2">
          <p>Key unlocked</p>
          {screen.prfFallbackReason && (
            <p>Fingerprint unlock was not used: {describeFallbackClause(screen.prfFallbackReason)}.</p>
          )}
          <p>Key fingerprint: {toHex(screen.key.slice(0, 4))}</p>
        </div>
      )}
    </main>
  );
}
