// src/cockpit/Composer.tsx — how he talks to the Mayor anywhere in the tree
// (plans/0021 decisions 10–12): words, a voice note recorded right here, photos
// from the camera, images, PDFs and text files from the picker, a paste, a
// drop, or files shared in from another app. Whatever he quotes rides at the
// top of what he sends. All the files go as one message, the words its caption.
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { Chip, Icon, IconButton, cx } from '../ui';
import { useWide } from './hooks';
import { canRecord, formatDuration, VoiceRecorder } from '../services/recorder';
import { refuseFile, sendToThread, useSend, type OutgoingFile } from './send';
import { toast } from '../ui/toastStore';
import type { ThreadRef } from '../services/threads';
import { takePendingShare } from './shareInbox';
import { quoteBlock } from './quote';
import { usePrompts } from './usePrompts';
import { beginsCall, checkPromptCall, matchPrompts } from '../model/prompts';
import { optionChip } from '../services/prompts';

interface Pending extends OutgoingFile {
  id: string;
  preview?: string;
  durationMs?: number;
}

let nextId = 1;

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
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<VoiceRecorder | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const { busy, run } = useSend();
  // On a phone the tab bar sits below the composer and keeps the bottom safe-area inset.
  const wide = useWide();

  useEffect(() => {
    const area = textarea.current;
    if (!prefill || !area) return;
    area.focus();
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
    });
  }, []);

  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - started), 250);
    return () => clearInterval(timer);
  }, [recording]);

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

  async function startRecording() {
    try {
      recorder.current = new VoiceRecorder();
      await recorder.current.start();
      setElapsed(0);
      setRecording(true);
    } catch (err) {
      toast(err instanceof Error && err.name === 'NotAllowedError' ? 'The microphone is blocked for Postern.' : 'Could not start recording.', 'error');
    }
  }

  async function stopRecording() {
    if (!recorder.current) return;
    const recording = await recorder.current.stop();
    recorder.current = null;
    setRecording(false);
    const refusal = refuseFile({ name: 'Voice note', type: recording.mime, size: recording.blob.size });
    if (refusal) {
      toast(refusal, 'error');
      return;
    }
    const pending = await toPending(recording.blob, `voice-${new Date().toISOString()}.${recording.mime.split('/')[1]}`, recording.durationMs);
    setFiles((current) => [...current, pending]);
  }

  function cancelRecording() {
    recorder.current?.cancel();
    recorder.current = null;
    setRecording(false);
  }

  // A text beginning '/' is a call to a saved prompt: it is checked against the signature before it can go.
  const call = text.trimStart();
  const calling = beginsCall(call);
  const { prompts, fresh } = usePrompts(calling);
  const offered = calling && prompts ? matchPrompts(call, prompts) : [];
  const verdict = calling && prompts ? checkPromptCall(call, prompts) : undefined;
  const checking = calling && prompts === undefined && fresh === undefined;
  const callError = verdict && !verdict.ok && offered.length === 0 ? verdict.error : undefined;
  const callBlocked = checking || (verdict !== undefined && !verdict.ok);

  function choosePrompt(name: string) {
    setText(`/${name} `);
    const area = textarea.current;
    if (!area) return;
    area.focus();
    // the box has not re-rendered yet: put the caret after the words once it has
    requestAnimationFrame(() => area.setSelectionRange(area.value.length, area.value.length));
  }

  async function send() {
    if (callBlocked) return;
    const body = `${quote ? quoteBlock(quote) : ''}${text.trim()}`;
    if (!body.trim() && files.length === 0) return;
    const sent = await run(() => sendToThread(thread, body, files, re));
    if (sent) {
      files.forEach((file) => file.preview && URL.revokeObjectURL(file.preview));
      setText('');
      setFiles([]);
      onClearQuote?.();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
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
      {offered.length > 0 && !recording && (
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
      <div className="flex items-end gap-1 px-2 py-2">
        {recording ? (
          <div className="flex h-11 flex-1 items-center gap-3 rounded-2xl bg-sunken px-3" role="status">
            <span className="h-2.5 w-2.5 animate-live rounded-full bg-danger" aria-hidden="true" />
            <span className="text-[14px] tabular-nums">{formatDuration(elapsed)}</span>
            <span className="text-[13px] text-muted">Recording…</span>
            <IconButton icon="x" label="Discard recording" size="sm" className="ml-auto" onClick={cancelRecording} />
          </div>
        ) : (
          <>
            <IconButton icon="attach" label="Attach files" onClick={() => picker.current?.click()} />
            <IconButton icon="camera" label="Take a photo" onClick={() => camera.current?.click()} className="lg:hidden" />
            <textarea
              ref={textarea}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              rows={1}
              aria-label="Message"
              placeholder={placeholder}
              autoFocus={autoFocus}
              className="max-h-[200px] min-h-11 flex-1 resize-none rounded-2xl py-2.5 leading-snug"
            />
          </>
        )}
        {recording ? (
          <IconButton icon="stop" label="Stop recording" tone="danger" size="lg" onClick={() => void stopRecording()} />
        ) : canSend ? (
          <IconButton icon="send" label="Send" tone="accent" size="lg" disabled={busy || !canSend || callBlocked} onClick={() => void send()} />
        ) : (
          <IconButton icon="mic" label="Record a voice note" size="lg" disabled={!canRecord()} onClick={() => void startRecording()} className={cx(!canRecord() && 'opacity-40')} />
        )}
      </div>
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
        accept="image/png,image/jpeg,image/webp,audio/*,application/pdf,text/plain"
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
