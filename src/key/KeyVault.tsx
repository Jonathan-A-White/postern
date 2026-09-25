import { Fragment, useEffect, useState } from 'react';
import { vaultRepo } from '../data/repositories';
import type { PrfFallbackReason, VaultRow } from '../data/db';
import { isWebAuthnAvailable, createPrfPasskey, getPrfSecret, describeUnlockError } from '../services/webauthnPrf';
import { getKey, setKey, lock as lockSession } from '../services/keySession';
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
import { fetchBalanceSatoshis, mintCostSatoshis, mintMyLicence } from '../services/mint';
import { addressForPublicKey, getCachedLicenceStatus } from '../services/licence';
import { LicenceExplainer } from '../licence';

type CopyStatus = 'idle' | 'copied' | 'unavailable';

const WHATSONCHAIN_TESTNET_TX_URL = 'https://test.whatsonchain.com/tx/';

type MintOutcome =
  | { name: 'idle' }
  | { name: 'minting' }
  | { name: 'success'; txid: string }
  | { name: 'error'; message: string };

type BalanceState =
  | { name: 'loading' }
  | { name: 'loaded'; satoshis: number }
  | { name: 'error'; message: string };

type LicenceState = { name: 'checking' } | { name: 'not-licensed' } | { name: 'licensed'; txid: string };

// Pure: reads the cached licence-status settings row the gate's own checks keep up to
// date (src/services/licence.ts), so opening the key screen never has to touch the
// chain itself. Called as `void determineLicenceState().then(setLicenceState)` so the
// setter is applied at the call site (see the balance effect for the same pattern).
async function determineLicenceState(): Promise<LicenceState> {
  const cached = await getCachedLicenceStatus();
  return cached?.held ? { name: 'licensed', txid: cached.outpoint.txid } : { name: 'not-licensed' };
}

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
  const [addressCopyStatus, setAddressCopyStatus] = useState<CopyStatus>('idle');
  const [balanceState, setBalanceState] = useState<BalanceState>({ name: 'loading' });
  const [balanceRefreshToken, setBalanceRefreshToken] = useState(0);
  const [mintOutcome, setMintOutcome] = useState<MintOutcome>({ name: 'idle' });
  const [licenceState, setLicenceState] = useState<LicenceState>({ name: 'checking' });

  useEffect(() => {
    void vaultRepo.get().then((vault) => {
      if (!vault) {
        setScreen({ name: 'empty' });
        return;
      }
      const cachedKey = getKey();
      setScreen(cachedKey ? { name: 'unlocked', key: cachedKey } : { name: 'locked', vault });
    });
  }, []);

  useEffect(() => {
    if (screen.name !== 'unlocked') return;
    const publicKeyHex = publicKeyHexFromMasterKey(screen.key);
    fetchBalanceSatoshis(publicKeyHex)
      .then((satoshis) => setBalanceState({ name: 'loaded', satoshis }))
      .catch((err) => setBalanceState({ name: 'error', message: (err as Error).message }));
  }, [screen, balanceRefreshToken]);

  useEffect(() => {
    if (screen.name !== 'unlocked') return;
    void determineLicenceState().then(setLicenceState);
  }, [screen]);

  function handleRefreshBalance() {
    setBalanceState({ name: 'loading' });
    setBalanceRefreshToken((token) => token + 1);
  }

  async function handleMint(key: Uint8Array) {
    setMintOutcome({ name: 'minting' });
    try {
      const result = await mintMyLicence(key);
      setMintOutcome({ name: 'success', txid: result.txid });
    } catch (err) {
      setMintOutcome({ name: 'error', message: (err as Error).message });
    }
  }

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

  async function handleCopyAddress(address: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API not available');
      await navigator.clipboard.writeText(address);
      setAddressCopyStatus('copied');
      setTimeout(() => setAddressCopyStatus('idle'), 3000);
    } catch {
      setAddressCopyStatus('unavailable');
    }
  }

  async function handleConfirmWritten(mnemonic: string, key: Uint8Array) {
    setError(null);
    try {
      const prfFallbackReason = await storeKey(mnemonic, key);
      setKey(key);
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
      setKey(key);
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
      setKey(key);
      setScreen({ name: 'unlocked', key });
    } catch (err) {
      setError(describeUnlockError(err));
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
      setKey(key);
      setScreen({ name: 'unlocked', key });
    } catch {
      setError('That recovery phrase did not unlock the key.');
    }
  }

  async function handleLock(): Promise<void> {
    lockSession();
    const vault = await vaultRepo.get();
    setScreen(vault ? { name: 'locked', vault } : { name: 'empty' });
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
          <button className="self-start rounded bg-slate-700 px-3 py-1 text-sm" onClick={() => void handleLock()}>
            Lock
          </button>
          {screen.prfFallbackReason && (
            <p>Fingerprint unlock was not used: {describeFallbackClause(screen.prfFallbackReason)}.</p>
          )}
          <p>Key fingerprint: {toHex(screen.key.slice(0, 4))}</p>

          <p className="text-sm text-slate-400">
            Testnet address:{' '}
            <span data-testid="testnet-address" className="break-all font-mono">
              {addressForPublicKey(publicKeyHexFromMasterKey(screen.key))}
            </span>
          </p>
          <button
            className="rounded bg-slate-700 px-4 py-2"
            onClick={() => void handleCopyAddress(addressForPublicKey(publicKeyHexFromMasterKey(screen.key)))}
          >
            {addressCopyStatus === 'copied' ? 'Copied' : 'Copy address'}
          </button>

          {balanceState.name === 'loading' && <p>Checking balance…</p>}

          {balanceState.name === 'loaded' && (
            <>
              <p>Balance: {balanceState.satoshis} sats</p>
              {licenceState.name !== 'licensed' && balanceState.satoshis < mintCostSatoshis() && (
                <p>
                  Needs {mintCostSatoshis().toLocaleString('en-US')} testnet sats; this key holds{' '}
                  {balanceState.satoshis}. Send testnet sats to{' '}
                  <span className="break-all font-mono">
                    {addressForPublicKey(publicKeyHexFromMasterKey(screen.key))}
                  </span>
                  .
                </p>
              )}
              <button className="rounded bg-slate-700 px-4 py-2" onClick={handleRefreshBalance}>
                Refresh balance
              </button>
            </>
          )}

          {balanceState.name === 'error' && (
            <>
              <p>Balance unavailable (WhatsOnChain): {balanceState.message}</p>
              <button className="rounded bg-slate-700 px-4 py-2" onClick={handleRefreshBalance}>
                Retry
              </button>
            </>
          )}

          {licenceState.name === 'licensed' ? (
            <>
              <p>Licensed</p>
              <p>
                Minted:{' '}
                <a className="break-all font-mono underline" href={`${WHATSONCHAIN_TESTNET_TX_URL}${licenceState.txid}`}>
                  {licenceState.txid}
                </a>
              </p>
            </>
          ) : (
            <>
              <button
                className="rounded bg-slate-700 px-4 py-2 disabled:opacity-50"
                disabled={
                  balanceState.name !== 'loaded' ||
                  balanceState.satoshis < mintCostSatoshis() ||
                  mintOutcome.name === 'minting'
                }
                onClick={() => void handleMint(screen.key)}
              >
                Mint my licence (testnet)
              </button>
              <LicenceExplainer />
            </>
          )}

          {mintOutcome.name === 'success' && (
            <p>
              Minted:{' '}
              <a className="break-all font-mono underline" href={`${WHATSONCHAIN_TESTNET_TX_URL}${mintOutcome.txid}`}>
                {mintOutcome.txid}
              </a>
            </p>
          )}

          {mintOutcome.name === 'error' && <p>{mintOutcome.message}</p>}
        </div>
      )}
    </main>
  );
}
