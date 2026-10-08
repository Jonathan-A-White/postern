// src/cockpit/Composer.tsx — how he talks to the Mayor anywhere in the tree
// (plans/0021 decisions 10–12): words, a voice note recorded right here, photos
// from the camera, any file from the picker, a paste, a
// drop, or files shared in from another app. Whatever he quotes rides at the
// top of what he sends. All the files go as one message, the words its caption.
// The mic beside Send opens the Talk line's hold-to-talk bar (mw-q6n8m0.3): hold it and the words
// stream on screen, let go and the words, the voice note and whatever is attached go as one message;
// slide off the bar first and nothing goes.
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { Button, Chip, Icon, IconButton, cx } from '../ui';
import { focusQuietly } from '../ui/focus';
import { useWide } from './hooks';
import { formatDuration, type Recording } from '../services/recorder';
import { isListenSupported } from '../services/listen';
import { refuseFile, sendToThread, useSend, type OutgoingFile } from './send';
import { toast } from '../ui/toastStore';
import type { ThreadRef } from '../services/threads';
import { takePendingShare } from './shareInbox';
import { quoteBlock } from './quote';
import { usePrompts } from './usePrompts';
import { HoldToTalkBar } from './HoldToTalkBar';
import { useHold } from './useHold';
import { useDraft } from './useDraft';
import { draftsRepo } from '../data/repositories';
import { beginsCall, checkPromptCall, halfTypedOption, matchPrompts, suggestNext } from '../model/prompts';
import { optionChip } from '../services/prompts';

interface Pending extends OutgoingFile {
  id: string;
  preview?: string;
  durationMs?: number;
}

let nextId = 1;

/** How long Send is held, while grey from a failed check, before it sends anyway. */
const FORCE_SEND_MS = 600;

/** What the hold-to-talk bar says a hold will do (or why it cannot be held now). */
function barLabel(listening: boolean, micOpen: boolean): string {
  if (!listening) return 'Hold to talk';
  return micOpen ? 'Release to send' : 'Starting the mic…';
}

async function toPending(file: File | Blob, name: string, durationMs?: number): Promise<Pending> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = file.type || 'application/octet-stream';
  return {
    id: String(nextId++),
    name,
    type,
    bytes,
    durationMs,
    preview: type.startsWith('image/') || type.startsWith('audio/') ? URL.createObjectURL(file) : undefined,
  };
}

/** The voice note a hold recorded, as a file for the message. */
function voiceFile(recording: Recording): Promise<Pending | undefined> {
  const refusal = refuseFile({ name: 'Voice note', type: recording.mime, size: recording.blob.size });
  if (refusal) {
    toast(`${refusal} The words went without the voice note.`, 'error');
    return Promise.resolve(undefined);
  }
  return toPending(recording.blob, `voice-${new Date().toISOString()}.${recording.mime.split('/')[1]}`, recording.durationMs);
}

export interface ComposerProps {
  thread: ThreadRef | undefined;
  placeholder?: string;
  quote?: { speaker: string; text: string } | null;
  onClearQuote?: () => void;
  autoFocus?: boolean;
  /** The txid this message answers: it goes out as a reply in that message's thread (docs/protocol.md §14). */
  re?: string;
  /** Words already in the box when it opens (Run on a prompt opens it saying '/name '); the caret waits after them. */
  prefill?: string;
}

export function Composer({ thread, placeholder = 'Message the Mayor…', quote, onClearQuote, autoFocus, re, prefill }: ComposerProps) {
  const [text, setText] = useState(prefill ?? '');
  const [files, setFiles] = useState<Pending[]>([]);
  // The hold-to-talk bar is out in place of the text box: the mic opened it, or a shared file arrived with no words.
  const [voice, setVoice] = useState(false);
  const [holding, setHolding] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  // What he has typed and not sent waits on the phone, per channel (and per post for a reply), through a lock-out or a reload.
  const draft = useDraft(draftsRepo.keyFor(thread, re), text, (saved) => setText((current) => current || saved), prefill);
  const picker = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const { busy, run } = useSend();
  const hold = useHold({ record: true, onFailed: () => setHolding(false) });
  // On a phone the tab bar sits below the composer and keeps the bottom safe-area inset.
  const wide = useWide();

  useEffect(() => {
    if (autoFocus) focusQuietly(textarea.current);
    // only when it opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const area = textarea.current;
    if (!prefill || !area) return;
    focusQuietly(area);
    area.setSelectionRange(area.value.length, area.value.length);
    // only when it opens: what he types after is his
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const shared = takePendingShare();
    if (!shared) return;
    void Promise.all(shared.files.map((file) => toPending(new Blob([file.bytes], { type: file.type }), file.name))).then((pending) => {
      setFiles((current) => [...current, ...pending]);
      if (shared.text) setText((current) => current || shared.text || '');
      // a file shared in with no words: the bar is ready, one hold sends the file with what he says
      else if (isListenSupported()) setVoice(true);
    });
  }, []);

  useEffect(() => {
    const area = textarea.current;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${Math.min(area.scrollHeight, 200)}px`;
  }, [text]);

  async function addFiles(list: FileList | File[]) {
    const accepted: Pending[] = [];
    for (const file of Array.from(list)) {
      const refusal = refuseFile(file);
      if (refusal) {
        toast(refusal, 'error');
        continue;
      }
      accepted.push(await toPending(file, file.name));
    }
    setFiles((current) => [...current, ...accepted]);
  }

  function press() {
    if (holding) return;
    setHolding(hold.begin());
  }

  async function release() {
    setHolding(false);
    const released = await hold.finish();
    if (released.status !== 'heard') return;
    const body = `${quote ? quoteBlock(quote) : ''}${released.text.trim()}`;
    const voiceNote = released.recording ? await voiceFile(released.recording) : undefined;
    const sent = await run(() => sendToThread(thread, body, voiceNote ? [...files, voiceNote] : files, re));
    if (sent) {
      files.forEach((file) => file.preview && URL.revokeObjectURL(file.preview));
      setFiles([]);
      onClearQuote?.();
    } else {
      // it did not go: the words and the voice note wait in the box, nothing he said is lost
      setText(released.text.trim());
      if (voiceNote) setFiles((current) => [...current, voiceNote]);
      setVoice(false);
    }
  }

  function drop() {
    setHolding(false);
    hold.drop();
  }

  // A text beginning '/' is a call to a saved prompt: it is checked against the signature before it can go.
  const call = text.trimStart();
  const calling = beginsCall(call);
  const { prompts, fresh } = usePrompts(calling);
  const offered = calling && prompts ? matchPrompts(call, prompts) : [];
  const verdict = calling && prompts ? checkPromptCall(call, prompts) : undefined;
  const checking = calling && prompts === undefined && fresh === undefined;
  // the grey text after the cursor: what one tap (or Tab, or →) adds to the box
  const suggestion = calling && prompts ? suggestNext(call, prompts) : undefined;
  // a half-typed option, or an option whose value is on offer in grey, is not an error yet (Send waits)
  const unfinished = suggestion !== undefined || (calling && prompts ? halfTypedOption(call, prompts) : false);
  const callError = verdict && !verdict.ok && offered.length === 0 && !unfinished ? verdict.error : undefined;
  const callFailed = verdict !== undefined && !verdict.ok;
  const callBlocked = checking || callFailed;

  function choosePrompt(name: string) {
    setText(`/${name} `);
    const area = textarea.current;
    if (!area) return;
    focusQuietly(area);
    // the box has not re-rendered yet: put the caret after the words once it has
    requestAnimationFrame(() => area.setSelectionRange(area.value.length, area.value.length));
  }

  function takeSuggestion() {
    if (!suggestion) return;
    setText(text + suggestion.rest);
    const area = textarea.current;
    if (!area) return;
    focusQuietly(area);
    requestAnimationFrame(() => area.setSelectionRange(area.value.length, area.value.length));
  }

  // a failed check only warns: holding the grey Send sends the text as typed anyway
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function releaseSend() {
    clearTimeout(holdTimer.current);
    holdTimer.current = undefined;
  }
  function holdSend() {
    releaseSend();
    holdTimer.current = setTimeout(() => {
      holdTimer.current = undefined;
      void send(true);
    }, FORCE_SEND_MS);
  }
  useEffect(() => releaseSend, []);

  async function send(force = false) {
    if (callBlocked && !(force && callFailed)) return;
    if (force && busy) return;
    const body = `${quote ? quoteBlock(quote) : ''}${text.trim()}`;
    if (!body.trim() && files.length === 0) return;
    const sent = await run(() => sendToThread(thread, body, files, re));
    if (sent) {
      files.forEach((file) => file.preview && URL.revokeObjectURL(file.preview));
      draft.discard();
      setText('');
      setFiles([]);
      onClearQuote?.();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const area = event.currentTarget;
    const atEnd = area.selectionStart === area.value.length && area.selectionEnd === area.value.length;
    if (suggestion && atEnd && (event.key === 'Tab' || event.key === 'ArrowRight') && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      takeSuggestion();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && (event.metaKey || event.ctrlKey || window.matchMedia?.('(pointer: fine)').matches)) {
      event.preventDefault();
      void send();
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = Array.from(event.clipboardData.files);
    if (pasted.length) {
      event.preventDefault();
      void addFiles(pasted);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    if (event.dataTransfer.files.length) {
      event.preventDefault();
      void addFiles(event.dataTransfer.files);
    }
  }

  const canSend = (text.trim().length > 0 || files.length > 0 || !!quote);
  // The bar takes the text box's place while there are no words in it (a draft that comes back from storage puts the box back).
  const barOut = voice && text.trim().length === 0 && hold.supported;
  // Pictures or files alone in the draft leave the mic beside Send; a voice note recorded in the draft (one per message), or words, take it away.
  const micBesideSend = text.trim().length === 0 && !quote && files.length > 0 && !files.some((file) => file.durationMs !== undefined);
  const mic = <IconButton icon="mic" label="Speak a message" size="lg" disabled={!hold.supported} onClick={() => setVoice(true)} className={cx(!hold.supported && 'opacity-40')} />;

  return (
    <div className={cx(wide && 'pb-safe', 'shrink-0 border-t border-line bg-surface')} onDragOver={(event) => event.preventDefault()} onDrop={onDrop} data-testid="composer">
      {quote && (
        <div className="flex items-start gap-2 border-b border-line px-3 py-2 text-[12.5px] text-muted">
          <Icon name="quote" size={14} className="mt-0.5 shrink-0" />
          <p className="line-clamp-2 flex-1">
            <span className="font-semibold">{quote.speaker}:</span> {quote.text}
          </p>
          <IconButton icon="x" label="Remove quote" size="sm" onClick={onClearQuote} />
        </div>
      )}
      {files.length > 0 && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-3 pt-3" aria-label="To send">
          {files.map((file) => (
            <div key={file.id} className="relative flex h-16 shrink-0 items-center gap-2 rounded-xl border border-line bg-sunken px-2">
              {file.type.startsWith('image/') && file.preview ? (
                <img src={file.preview} alt={file.name} className="h-12 w-12 rounded-lg object-cover" />
              ) : file.type.startsWith('audio/') ? (
                <span className="flex items-center gap-1.5 pr-2 text-[12.5px] text-muted">
                  <Icon name="mic" size={16} className="text-accent" />
                  Voice note {file.durationMs !== undefined ? formatDuration(file.durationMs) : ''}
                </span>
              ) : (
                <span className="flex max-w-40 items-center gap-1.5 pr-2 text-[12.5px] text-muted">
                  <Icon name="file" size={16} />
                  <span className="truncate">{file.name}</span>
                </span>
              )}
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-raised text-muted"
                onClick={() => setFiles((current) => current.filter((f) => f.id !== file.id))}
              >
                <Icon name="x" size={11} strokeWidth={2.4} />
              </button>
            </div>
          ))}
        </div>
      )}
      {offered.length > 0 && (
        <div role="listbox" aria-label="Saved prompts" className="flex max-h-56 flex-col overflow-y-auto border-b border-line">
          {offered.map((prompt) => (
            <button
              key={prompt.name}
              type="button"
              role="option"
              aria-selected={false}
              className="flex flex-col gap-1 px-4 py-2 text-left active:bg-sunken"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choosePrompt(prompt.name)}
            >
              <span className="font-mono text-[14px] font-semibold">/{prompt.name}</span>
              <span className="text-[13px] text-muted">{prompt.summary}</span>
              {prompt.signature.length > 0 && (
                <span className="flex flex-wrap gap-1.5">
                  {prompt.signature.map((option) => (
                    <Chip key={option.flag} mono tone={option.required ? 'needs' : 'neutral'}>
                      {optionChip(option)}
                    </Chip>
                  ))}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {barOut ? (
        <div className="flex flex-col items-center gap-2 px-4 pt-3 pb-3">
          <div role="status" aria-live="polite" className="min-h-[2.75rem] w-full max-w-xl text-center text-[14px]">
            {holding ? (
              <p data-testid="live-transcript" className="text-fg">
                {hold.mic === 'ready' ? hold.transcript || 'Listening…' : 'Starting the mic…'}
              </p>
            ) : (
              <p className={hold.notice ? 'text-danger' : 'text-muted'}>{hold.notice ?? 'Hold the bar and speak. Slide off it to drop.'}</p>
            )}
          </div>
          <HoldToTalkBar
            label={barLabel(holding, hold.mic === 'ready')}
            listening={holding}
            disabled={busy}
            onPress={press}
            onRelease={() => void release()}
            onAbort={drop}
            dropOnSlideOff
          />
          <div className="flex w-full max-w-xl items-center gap-1">
            <IconButton icon="attach" label="Attach files" onClick={() => picker.current?.click()} />
            <IconButton icon="camera" label="Take a photo" onClick={() => camera.current?.click()} className="lg:hidden" />
            <Button variant="ghost" size="sm" className="ml-auto" disabled={holding} onClick={() => setVoice(false)}>
              Type a message
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-end gap-1 px-2 py-2">
          <IconButton icon="attach" label="Attach files" onClick={() => picker.current?.click()} />
          <IconButton icon="camera" label="Take a photo" onClick={() => camera.current?.click()} className="lg:hidden" />
          <div className="relative min-w-0 flex-1">
            <textarea
              ref={textarea}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              rows={1}
              aria-label="Message"
              placeholder={placeholder}
              className="max-h-[200px] min-h-11 w-full resize-none rounded-2xl py-2.5 leading-snug"
            />
            {suggestion && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl border border-transparent px-3 py-2.5 text-base leading-snug break-words whitespace-pre-wrap">
                <span className="invisible">{text}</span>
                <button
                  type="button"
                  data-testid="grey-suggestion"
                  aria-label={`Add ${suggestion.text}`}
                  tabIndex={-1}
                  className="pointer-events-auto cursor-pointer text-faint"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={takeSuggestion}
                >
                  {suggestion.rest}
                </button>
              </div>
            )}
          </div>
          {canSend && callFailed ? (
            <span
              data-testid="send-force"
              className="inline-flex shrink-0 touch-none select-none"
              onPointerDown={holdSend}
              onPointerUp={releaseSend}
              onPointerLeave={releaseSend}
              onPointerCancel={releaseSend}
              onContextMenu={(event) => event.preventDefault()}
            >
              <IconButton icon="send" label="Send (hold to send anyway)" tone="accent" size="lg" disabled className="pointer-events-none [-webkit-touch-callout:none]" />
            </span>
          ) : canSend ? (
            <>
              {micBesideSend && mic}
              <IconButton icon="send" label="Send" tone="accent" size="lg" disabled={busy || !canSend || callBlocked} onClick={() => void send()} />
            </>
          ) : (
            mic
          )}
        </div>
      )}
      {callError && (
        <p role="alert" className="px-4 pb-2 text-[12.5px] text-danger">
          {callError}
        </p>
      )}
      {checking && (
        <p role="status" className="px-4 pb-2 text-[12.5px] text-muted">
          Checking the saved prompts…
        </p>
      )}
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) void addFiles(event.target.files);
          event.target.value = '';
        }}
      />
      <input
        ref={camera}
        type="file"
        hidden
        accept="image/*"
        capture="environment"
        onChange={(event) => {
          if (event.target.files) void addFiles(event.target.files);
          event.target.value = '';
        }}
      />
    </div>
  );
}
