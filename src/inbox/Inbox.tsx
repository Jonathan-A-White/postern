import { useEffect, useRef, useState } from 'react';
import { vaultRepo, messagesRepo } from '../data/repositories';
import type { MessageRow, VaultRow } from '../data/db';
import { getPrfSecret } from '../services/webauthnPrf';
import { deriveAesKeyFromPrf, deriveAesKeyFromPhrase, unwrapKey, findInvalidWords } from '../services/vault';
import { decryptPendingMessages, syncMessages } from '../services/inbox';

type VaultScreen =
  | { name: 'loading' }
  | { name: 'no-key' }
  | { name: 'locked'; vault: VaultRow }
  | { name: 'ready'; key: Uint8Array };

function describeInvalidWords(words: string[]): string {
  const quoted = words.map((word) => `'${word}'`).join(', ');
  return words.length === 1
    ? `${quoted} is not a word of the recovery list.`
    : `${quoted} are not words of the recovery list.`;
}

function messageBodyText(row: MessageRow): string {
  if (row.direction === 'sent') return 'Sent message.';
  if (row.plaintext !== undefined) return row.plaintext;
  if (row.decryptFailed) return 'Unreadable message.';
  return 'Locked';
}

export function Inbox() {
  const [screen, setScreen] = useState<VaultScreen>({ name: 'loading' });
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [phraseInput, setPhraseInput] = useState('');
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [syncError, setSyncError] = useState<string | null>(null);
  // Holds the initial background sync so an unlock (which can happen before that
  // sync's fetch resolves) waits for it to finish storing records before it tries
  // to decrypt them — otherwise a fast unlock could race the fetch and decrypt
  // nothing because the row it wants doesn't exist yet.
  const initialSyncRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    initialSyncRef.current = vaultRepo
      .get()
      .then((vault) => {
        setScreen(vault ? { name: 'locked', vault } : { name: 'no-key' });
        return vault;
      })
      .then((vault) =>
        vault
          ? syncMessages({ publicKeyHex: vault.publicKeyHex }).catch((err) => setSyncError((err as Error).message))
          : undefined,
      )
      .then(() => messagesRepo.getAll())
      .then(setMessages);
  }, []);

  async function refreshMessages(): Promise<void> {
    setMessages(await messagesRepo.getAll());
  }

  // mw-1589l.7: a click on a push notification (self.clients.openWindow, or
  // focusing an already-open tab) should show what arrived since the last
  // sync, and so should simply refocusing the tab — this is the app's only
  // background-sync signal, since a PWA can't poll on its own.
  useEffect(() => {
    function resync() {
      void vaultRepo
        .get()
        .then((vault) => (vault ? syncMessages({ publicKeyHex: vault.publicKeyHex }).catch(() => undefined) : undefined))
        .then(() => refreshMessages());
    }

    function handleServiceWorkerMessage(event: MessageEvent) {
      if ((event.data as { type?: string } | undefined)?.type === 'sync-inbox') resync();
    }

    window.addEventListener('focus', resync);
    navigator.serviceWorker?.addEventListener('message', handleServiceWorkerMessage);
    return () => {
      window.removeEventListener('focus', resync);
      navigator.serviceWorker?.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, []);

  async function handleUnlockWithFingerprint(vault: VaultRow) {
    setUnlockError(null);
    try {
      if (!vault.credentialId) throw new Error('No passkey is registered for this key.');
      const prfSecret = await getPrfSecret(vault.credentialId);
      if (!prfSecret) throw new Error('The passkey did not return a PRF secret.');
      const aesKey = await deriveAesKeyFromPrf(prfSecret);
      const key = await unwrapKey({ ciphertext: vault.ciphertext, iv: vault.iv }, aesKey);
      setScreen({ name: 'ready', key });
      await initialSyncRef.current;
      await decryptPendingMessages(key);
      await refreshMessages();
    } catch (err) {
      setUnlockError((err as Error).message);
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
      setScreen({ name: 'ready', key });
      await initialSyncRef.current;
      await decryptPendingMessages(key);
      await refreshMessages();
    } catch {
      setUnlockError('That recovery phrase did not unlock the key.');
    }
  }

  async function handleOpenMessage(row: MessageRow) {
    if (row.read) return;
    await messagesRepo.markRead(row.id);
    await refreshMessages();
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-4 bg-slate-900 p-6 text-slate-200">
      <h1 className="text-2xl font-semibold">Inbox</h1>
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

      {syncError && <p className="text-sm text-slate-400">Offline — showing stored messages ({syncError})</p>}

      {screen.name !== 'loading' && screen.name !== 'no-key' && messages.length === 0 && <p>No messages yet.</p>}

      {screen.name !== 'loading' && screen.name !== 'no-key' && messages.length > 0 && (
        <ul className="flex w-full max-w-md flex-col gap-2">
          {messages.map((row) => (
            <li key={row.id}>
              <button className="w-full rounded bg-slate-800 p-3 text-left" onClick={() => void handleOpenMessage(row)}>
                <p className="text-xs text-slate-400">
                  {row.class} · {new Date(row.ts * 1000).toISOString()}
                  {row.direction === 'received' && !row.read ? ' · unread' : ''}
                </p>
                <p>{messageBodyText(row)}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
