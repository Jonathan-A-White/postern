// src/threads/ThreadScreen.tsx — mw-f758y.21.3: one thread's messages, oldest
// first, with a reply box at the bottom whose reply carries the same thread
// (src/services/threads.ts's encodeThreadedMessage).
import { useEffect, useState } from 'react';
import { vaultRepo, messagesRepo } from '../data/repositories';
import type { MessageRow } from '../data/db';
import { decryptPendingMessages, syncMessages } from '../services/inbox';
import { getMayorPublicKey } from '../services/messages';
import { decodeQuestion, decodeReply } from '../services/questions';
import { sendTextMessage } from '../services/send';
import { decodeThreadedMessage, encodeThreadedMessage, threadKey, type ThreadRef } from '../services/threads';
import { useSnapshotScreen } from '../projects/useSnapshotScreen';
import { VaultGate } from '../projects/VaultGate';
import { titleForThread } from './grouping';

export interface ThreadScreenProps {
  threadRef?: ThreadRef;
}

type SendState =
  | { name: 'idle' }
  | { name: 'sending' }
  | { name: 'sent'; txid: string }
  | { name: 'error'; message: string };

/** A thread message's body text: a decision-needed question's own text, a
 * reply's own answer, or a threaded (or plain) message's text — never the raw
 * JSON any of those three shapes decrypt to. */
function messageText(row: MessageRow): string {
  if (row.plaintext === undefined) {
    if (row.direction === 'sent') return 'Sent message.';
    if (row.decryptFailed) return 'Unreadable message.';
    return 'Locked';
  }
  if (row.class === 'decision-needed') {
    const question = decodeQuestion(row.plaintext);
    if (question) return question.q;
  }
  if (row.class === 'message') {
    const reply = decodeReply(row.plaintext);
    if (reply) return reply.answer;
  }
  return decodeThreadedMessage(row.plaintext).text;
}

export function ThreadScreen({ threadRef }: ThreadScreenProps) {
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
  const [mayorPublicKey, setMayorPublicKeyState] = useState<string | undefined>(undefined);
  const [text, setText] = useState('');
  const [sendState, setSendState] = useState<SendState>({ name: 'idle' });

  useEffect(() => {
    void getMayorPublicKey().then(setMayorPublicKeyState);
  }, []);

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

  const key = threadKey(threadRef);
  const threadMessages = messages.filter((row) => row.thread === key).sort((a, b) => a.ts - b.ts);
  const title = titleForThread(threadRef, snapshotState.snapshot);

  async function handleReply(unlockedKey: Uint8Array, recipientPublicKeyHex: string): Promise<void> {
    if (text.trim().length === 0) return;
    setSendState({ name: 'sending' });
    try {
      const txid = await sendTextMessage({
        text: encodeThreadedMessage({ thread: threadRef, text }),
        class: 'message',
        senderKey: unlockedKey,
        recipientPublicKeyHex,
      });
      setSendState({ name: 'sent', txid });
      setText('');
    } catch (err) {
      setSendState({ name: 'error', message: (err as Error).message });
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-4 bg-slate-900 p-6 text-slate-200">
      <h1 className="text-xl font-semibold">{title}</h1>
      <a className="text-sm underline" href="?screen=threads">
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
        <div className="flex w-full max-w-md flex-col gap-3">
          {threadMessages.length === 0 && <p>No messages yet.</p>}
          <ul className="flex flex-col gap-2">
            {threadMessages.map((row) => (
              <li key={row.id} data-testid="thread-message" className="rounded bg-slate-800 p-3">
                {messageText(row)}
              </li>
            ))}
          </ul>

          {mayorPublicKey && (
            <div className="flex flex-col gap-2">
              <label htmlFor="thread-reply-text">Reply</label>
              <textarea id="thread-reply-text" value={text} onChange={(e) => setText(e.target.value)} />
              <button
                className="rounded bg-slate-700 px-4 py-2"
                disabled={sendState.name === 'sending' || text.trim().length === 0}
                onClick={() => void handleReply(vaultState.key, mayorPublicKey)}
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
        </div>
      )}
    </main>
  );
}
