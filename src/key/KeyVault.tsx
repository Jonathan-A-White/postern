import { Fragment, useEffect, useState } from 'react';
import { vaultRepo } from '../data/repositories';
import type { VaultRow } from '../data/db';
import { isWebAuthnAvailable, createPrfPasskey, getPrfSecret } from '../services/webauthnPrf';
import {
  createMnemonic,
  isValidMnemonic,
  findInvalidWords,
  deriveMasterKey,
  deriveAesKeyFromPrf,
  deriveAesKeyFromPhrase,
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
  | { name: 'unlocked'; key: Uint8Array };

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

async function storeKey(mnemonic: string, key: Uint8Array): Promise<void> {
  if (isWebAuthnAvailable()) {
    const passkey = await createPrfPasskey('postern-governor', 'The Governor');
    if (passkey.prfSupported) {
      const prfSecret = await getPrfSecret(passkey.credentialId);
      if (prfSecret) {
        const aesKey = await deriveAesKeyFromPrf(prfSecret);
        const wrapped = await wrapKey(key, aesKey);
        await vaultRepo.save({
          mode: 'prf',
          ciphertext: wrapped.ciphertext,
          iv: wrapped.iv,
          credentialId: passkey.credentialId,
        });
        return;
      }
    }
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const aesKey = await deriveAesKeyFromPhrase(mnemonic, salt);
  const wrapped = await wrapKey(key, aesKey);
  await vaultRepo.save({ mode: 'phrase', ciphertext: wrapped.ciphertext, iv: wrapped.iv, salt });
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
      await storeKey(mnemonic, key);
      setScreen({ name: 'unlocked', key });
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
      await storeKey(phraseInput, key);
      setPhraseInput('');
      setScreen({ name: 'unlocked', key });
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
          <p>Unlock with your fingerprint.</p>
          <button
            className="rounded bg-slate-700 px-4 py-2"
            onClick={() => void handleUnlockWithFingerprint(screen.vault)}
          >
            Unlock with fingerprint
          </button>
        </div>
      )}

      {screen.name === 'locked' && screen.vault.mode === 'phrase' && (
        <div className="flex flex-col gap-2">
          <p>
            This phone holds your key wrapped by the recovery phrase (fingerprint unlock was not
            available when it was created): type the twelve words
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
          <p>Key fingerprint: {toHex(screen.key.slice(0, 4))}</p>
        </div>
      )}
    </main>
  );
}
