// src/threads/ThreadsScreen.tsx — mw-f758y.21.3: one row per thread, newest
// activity first, the general thread last; a New topic control opens a named
// thread that doesn't need any message to exist yet.
import { useEffect, useState } from 'react';
import { vaultRepo, messagesRepo } from '../data/repositories';
import type { MessageRow } from '../data/db';
import { decryptPendingMessages, syncMessages } from '../services/inbox';
import { threadKey } from '../services/threads';
import { useSnapshotScreen } from '../projects/useSnapshotScreen';
import { VaultGate } from '../projects/VaultGate';
import { summarizeThreads } from './grouping';

export function ThreadsScreen() {
  const {
    vaultState,
    unlockError,
    phraseInput,
    setPhraseInput,
    handleUnlockWithFingerprint,
    handleUnlockWithPhrase,
    handleLock,
    snapshotState,
  } = useSnapshotScreen();

  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [topicInput, setTopicInput] = useState('');

  useEffect(() => {
    if (vaultState.name !== 'ready') return;
    const key = vaultState.key;
    void vaultRepo
      .get()
      .then((vault) => (vault ? syncMessages({ publicKeyHex: vault.publicKeyHex, unlockedKey: key }).catch(() => undefined) : undefined))
      .then(() => decryptPendingMessages(key))
      .then(() => messagesRepo.getAll())
      .then(setMessages);
  }, [vaultState]);

  const threads = summarizeThreads(messages, snapshotState.snapshot);
  const trimmedTopic = topicInput.trim();
  const topicKey = trimmedTopic ? threadKey({ topic: trimmedTopic }) : undefined;
  const topicHref = topicKey ? `?screen=thread&thread=${encodeURIComponent(topicKey)}` : undefined;

  return (
    <main className="flex min-h-screen flex-col items-center gap-4 bg-slate-900 p-6 text-slate-200">
      <h1 className="text-2xl font-semibold">Threads</h1>
      <a className="text-sm underline" href="/">
        Back
      </a>

      <VaultGate
        vaultState={vaultState}
        unlockError={unlockError}
        phraseInput={phraseInput}
        setPhraseInput={setPhraseInput}
        onUnlockWithFingerprint={(vault) => void handleUnlockWithFingerprint(vault)}
        onUnlockWithPhrase={(vault) => void handleUnlockWithPhrase(vault)}
        onLock={() => void handleLock()}
      />

      {vaultState.name === 'ready' && (
        <div className="flex w-full max-w-md flex-col gap-4">
          <div className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor="new-topic-name">New topic</label>
              <input id="new-topic-name" value={topicInput} onChange={(e) => setTopicInput(e.target.value)} />
            </div>
            <a
              className={`rounded bg-slate-700 px-3 py-2 text-sm ${topicHref ? '' : 'pointer-events-none opacity-50'}`}
              href={topicHref}
            >
              Open topic
            </a>
          </div>

          {threads.length === 0 && <p>No threads yet.</p>}

          <ul className="flex flex-col gap-2">
            {threads.map((thread) => (
              <li key={thread.key ?? 'general'} data-testid="thread-row">
                <a
                  className="block rounded bg-slate-800 p-3"
                  href={`?screen=thread${thread.key ? `&thread=${encodeURIComponent(thread.key)}` : ''}`}
                >
                  <p className="font-semibold">{thread.title}</p>
                  {thread.unreadCount > 0 && <p className="text-xs text-slate-400">{thread.unreadCount} unread</p>}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
