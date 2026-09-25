import { useEffect, useState } from 'react';
import { vaultRepo } from '../data/repositories';
import type { VaultRow } from '../data/db';
import { getPrfSecret, describeUnlockError } from '../services/webauthnPrf';
import { deriveAesKeyFromPrf, deriveAesKeyFromPhrase, unwrapKey, findInvalidWords } from '../services/vault';
import { getKey, setKey, lock as lockSession } from '../services/keySession';
import { isValidCompressedPublicKeyHex } from 'spell-forge-bsv';
import { getMayorPublicKey, setMayorPublicKey } from '../services/messages';
import { sendTextMessage } from '../services/send';

type VaultScreen =
  | { name: 'loading' }
  | { name: 'no-key' }
  | { name: 'locked'; vault: VaultRow }
  | { name: 'ready'; key: Uint8Array };

type SendState =
  | { name: 'idle' }
  | { name: 'sending' }
  | { name: 'sent'; txid: string }
  | { name: 'error'; message: string };

function describeInvalidWords(words: string[]): string {
  const quoted = words.map((word) => `'${word}'`).join(', ');
  return words.length === 1
    ? `${quoted} is not a word of the recovery list.`
    : `${quoted} are not words of the recovery list.`;
}

export function Compose() {
  const [screen, setScreen] = useState<VaultScreen>({ name: 'loading' });
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [phraseInput, setPhraseInput] = useState('');

  const [recipient, setRecipient] = useState<string | undefined>(undefined);
  const [recipientInput, setRecipientInput] = useState('');
  const [recipientError, setRecipientError] = useState<string | null>(null);

  const [text, setText] = useState('');
  const [sendState, setSendState] = useState<SendState>({ name: 'idle' });

  useEffect(() => {
    void Promise.all([vaultRepo.get(), getMayorPublicKey()]).then(([vault, mayorPublicKey]) => {
      setRecipient(mayorPublicKey);
      if (!vault) {
        setScreen({ name: 'no-key' });
        return;
      }
      const cachedKey = getKey();
      setScreen(cachedKey ? { name: 'ready', key: cachedKey } : { name: 'locked', vault });
    });
  }, []);

  async function handleUnlockWithFingerprint(vault: VaultRow) {
    setUnlockError(null);
    try {
      if (!vault.credentialId) throw new Error('No passkey is registered for this key.');
      const prfSecret = await getPrfSecret(vault.credentialId);
      if (!prfSecret) throw new Error('The passkey did not return a PRF secret.');
      const aesKey = await deriveAesKeyFromPrf(prfSecret);
      const key = await unwrapKey({ ciphertext: vault.ciphertext, iv: vault.iv }, aesKey);
      setKey(key);
      setScreen({ name: 'ready', key });
    } catch (err) {
      setUnlockError(describeUnlockError(err));
    }
  }

  async function handleUnlockWithPhrase(vault: VaultRow) {
    setUnlockError(null);
    const invalidWords = findInvalidWords(phraseInput);
    if (invalidWords.length > 0) {
      setUnlockError(describeInvalidWords(invalidWords));
      return;
    }
    try {
      if (!vault.salt) throw new Error('No recovery salt is stored for this key.');
      const aesKey = await deriveAesKeyFromPhrase(phraseInput, vault.salt);
      const key = await unwrapKey({ ciphertext: vault.ciphertext, iv: vault.iv }, aesKey);
      setPhraseInput('');
      setKey(key);
      setScreen({ name: 'ready', key });
    } catch {
      setUnlockError('That recovery phrase did not unlock the key.');
    }
  }

  async function handleLock(): Promise<void> {
    lockSession();
    const vault = await vaultRepo.get();
    setScreen(vault ? { name: 'locked', vault } : { name: 'no-key' });
  }

  async function handleSaveRecipient() {
    const trimmed = recipientInput.trim();
    if (!isValidCompressedPublicKeyHex(trimmed)) {
      setRecipientError('That is not a valid compressed public key.');
      return;
    }
    setRecipientError(null);
    await setMayorPublicKey(trimmed);
    setRecipient(trimmed);
    setRecipientInput('');
  }

  async function handleSend(key: Uint8Array) {
    if (!recipient || text.trim().length === 0) return;
    setSendState({ name: 'sending' });
    try {
      const txid = await sendTextMessage({
        text,
        class: 'message',
        senderKey: key,
        recipientPublicKeyHex: recipient,
      });
      setSendState({ name: 'sent', txid });
      setText('');
    } catch (err) {
      setSendState({ name: 'error', message: (err as Error).message });
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-900 p-6 text-slate-200">
      <h1 className="text-2xl font-semibold">Send a message</h1>
      <a className="text-sm underline" href="/">
        Back
      </a>

      {screen.name === 'loading' && <p>Loading…</p>}

      {screen.name === 'no-key' && (
        <div className="flex flex-col gap-2">
          <p>No key is set up on this phone yet.</p>
          <a className="text-sm underline" href="?screen=key">
            Set up your key
          </a>
        </div>
      )}

      {screen.name !== 'loading' && screen.name !== 'no-key' && (
        <div className="flex flex-col gap-2">
          <p>
            Mayor&apos;s public key:{' '}
            {recipient ? <span className="break-all font-mono">{recipient}</span> : 'not set'}
          </p>
          <label htmlFor="mayor-public-key">{recipient ? 'Change the Mayor’s public key' : 'Mayor’s public key'}</label>
          <input
            id="mayor-public-key"
            value={recipientInput}
            onChange={(e) => setRecipientInput(e.target.value)}
          />
          {recipientError && (
            <p role="alert" className="text-red-400">
              {recipientError}
            </p>
          )}
          <button className="rounded bg-slate-700 px-4 py-2" onClick={() => void handleSaveRecipient()}>
            Save recipient
          </button>
        </div>
      )}

      {unlockError && (
        <p role="alert" className="text-red-400">
          {unlockError}
        </p>
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
          <label htmlFor="recovery-phrase">Recovery phrase</label>
          <textarea id="recovery-phrase" value={phraseInput} onChange={(e) => setPhraseInput(e.target.value)} />
          <button className="rounded bg-slate-700 px-4 py-2" onClick={() => void handleUnlockWithPhrase(screen.vault)}>
            Unlock
          </button>
        </div>
      )}

      {screen.name === 'ready' && recipient && (
        <div className="flex flex-col gap-2">
          <button
            className="self-start rounded bg-slate-700 px-3 py-1 text-sm"
            onClick={() => void handleLock()}
          >
            Lock
          </button>
          <label htmlFor="message-text">Message</label>
          <textarea id="message-text" value={text} onChange={(e) => setText(e.target.value)} />
          <button
            className="rounded bg-slate-700 px-4 py-2"
            disabled={sendState.name === 'sending' || text.trim().length === 0}
            onClick={() => void handleSend(screen.key)}
          >
            Send
          </button>
          {sendState.name === 'sending' && <p>Sending…</p>}
          {sendState.name === 'sent' && <p>Sent. Transaction id: {sendState.txid}</p>}
          {sendState.name === 'error' && (
            <p role="alert" className="text-red-400">
              {sendState.message}
            </p>
          )}
        </div>
      )}
    </main>
  );
}
