// src/threads/ThreadScreen.tsx — mw-f758y.21.3: one thread's messages, oldest
// first, with a reply box at the bottom whose reply carries the same thread
// (src/services/threads.ts's encodeThreadedMessage).
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { vaultRepo, messagesRepo } from '../data/repositories';
import type { MessageRow } from '../data/db';
import { decryptPendingMessages, syncMessages } from '../services/inbox';
import { getMayorPublicKey } from '../services/messages';
import { decodeQuestion, decodeReply } from '../services/questions';
import { sendTextMessage } from '../services/send';
import { MAX_ATTACHMENT_BYTES, uploadAttachment } from '../services/attachments';
import { decodeThreadedMessage, encodeThreadedMessage, threadKey, type Attachment, type ThreadRef } from '../services/threads';
import { useSnapshotScreen } from '../projects/useSnapshotScreen';
import { VaultGate } from '../projects/VaultGate';
import { Markdown } from '../markdown';
import { titleForThread } from './grouping';

function formatKB(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const MAX_ATTACHMENT_MB = MAX_ATTACHMENT_BYTES / (1024 * 1024);

export interface ThreadScreenProps {
  threadRef?: ThreadRef;
}

type SendState =
  | { name: 'idle' }
  | { name: 'sending' }
  | { name: 'sent'; txid: string }
  | { name: 'error'; message: string };

interface DisplayMessage {
  text: string;
  /** Markdown formatting is only for a received `message`-class row whose
   * plaintext is a threaded (or plain) message body — every other shape
   * (a sent message, a decision-needed question, a reply, an alarm) renders
   * as plain text, unchanged from before Markdown existed. */
  markdown: boolean;
}

/** A thread message's body: a decision-needed question's own text, a reply's
 * own answer, or a threaded (or plain) message's text — never the raw JSON
 * any of those three shapes decrypt to. */
function displayMessage(row: MessageRow): DisplayMessage {
  if (row.plaintext === undefined) {
    if (row.direction === 'sent') return { text: 'Sent message.', markdown: false };
    if (row.decryptFailed) return { text: 'Unreadable message.', markdown: false };
    return { text: 'Locked', markdown: false };
  }
  if (row.class === 'decision-needed') {
    const question = decodeQuestion(row.plaintext);
    if (question) return { text: question.q, markdown: false };
  }
  if (row.class === 'message') {
    const reply = decodeReply(row.plaintext);
    if (reply) return { text: reply.answer, markdown: false };
  }
  const body = decodeThreadedMessage(row.plaintext);
  if (body.attachment) {
    if (row.direction !== 'sent') return { text: 'Image', markdown: false };
    const caption = body.text.length > 0 ? body.text : 'Sent message.';
    return { text: `${caption} — Image, ${formatKB(body.attachment.size)}`, markdown: false };
  }
  return { text: body.text, markdown: row.class === 'message' && row.direction !== 'sent' };
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
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [attachError, setAttachError] = useState<string | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getMayorPublicKey().then(setMayorPublicKeyState);
  }, []);

  async function fetchMessages(unlockedKey: Uint8Array): Promise<MessageRow[]> {
    const vault = await vaultRepo.get();
    if (vault) {
      await syncMessages({ publicKeyHex: vault.publicKeyHex, unlockedKey }).catch(() => undefined);
    }
    await decryptPendingMessages(unlockedKey);
    return messagesRepo.getAll();
  }

  useEffect(() => {
    if (vaultState.name !== 'ready') return;
    void fetchMessages(vaultState.key).then(setMessages);
  }, [vaultState]);

  const key = threadKey(threadRef);
  const threadMessages = messages.filter((row) => row.thread === key).sort((a, b) => a.ts - b.ts);
  const title = titleForThread(threadRef, snapshotState.snapshot);

  function handleFileSelected(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setAttachError(`Images must be ${MAX_ATTACHMENT_MB} MB or smaller.`);
      setAttachedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setAttachError(undefined);
    setAttachedFile(file);
  }

  function handleRemoveAttachment(): void {
    setAttachedFile(null);
    setAttachError(undefined);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleReply(unlockedKey: Uint8Array, recipientPublicKeyHex: string): Promise<void> {
    if (text.trim().length === 0 && !attachedFile) return;
    setSendState({ name: 'sending' });
    try {
      let attachment: Attachment | undefined;
      if (attachedFile) {
        const bytes = new Uint8Array(await attachedFile.arrayBuffer());
        attachment = await uploadAttachment({
          bytes,
          mime: attachedFile.type,
          senderKey: unlockedKey,
          recipientPublicKeyHex,
        });
      }
      const txid = await sendTextMessage({
        text: encodeThreadedMessage({ thread: threadRef, text, attachment }),
        class: 'message',
        senderKey: unlockedKey,
        recipientPublicKeyHex,
      });
      setSendState({ name: 'sent', txid });
      setText('');
      handleRemoveAttachment();
      setMessages(await fetchMessages(unlockedKey));
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
          <ul className="message-list flex flex-col gap-2">
            {threadMessages.map((row) => {
              const { text, markdown } = displayMessage(row);
              return (
                <li key={row.id} data-testid="thread-message" className="rounded bg-slate-800 p-3">
                  {markdown ? <Markdown text={text} /> : text}
                </li>
              );
            })}
          </ul>

          {mayorPublicKey && (
            <div className="flex flex-col gap-2">
              <label htmlFor="thread-reply-text">Reply</label>
              <textarea id="thread-reply-text" value={text} onChange={(e) => setText(e.target.value)} />
              <div className="flex items-center gap-2">
                <label
                  htmlFor="thread-attach-input"
                  className="cursor-pointer rounded bg-slate-700 px-3 py-1 text-sm"
                >
                  Attach image
                </label>
                <input
                  ref={fileInputRef}
                  id="thread-attach-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={handleFileSelected}
                />
                {attachedFile && (
                  <span className="text-sm">
                    {attachedFile.name}, {formatKB(attachedFile.size)}{' '}
                    <button type="button" className="underline" onClick={handleRemoveAttachment}>
                      Remove
                    </button>
                  </span>
                )}
              </div>
              {attachError && (
                <p role="alert" className="text-red-400">
                  {attachError}
                </p>
              )}
              <button
                className="rounded bg-slate-700 px-4 py-2"
                disabled={sendState.name === 'sending' || (text.trim().length === 0 && !attachedFile)}
                onClick={() => void handleReply(vaultState.key, mayorPublicKey)}
              >
                Send
              </button>
              {sendState.name === 'sending' && <p>Sending…</p>}
              {sendState.name === 'sent' && (
                <p className="break-all font-mono">Sent. Transaction id: {sendState.txid}</p>
              )}
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
