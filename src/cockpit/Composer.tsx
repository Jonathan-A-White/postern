// src/cockpit/Composer.tsx — how he talks to the Mayor anywhere in the tree (plans/0021 decisions 10–12). The bar is
// voice-kit's Composer (mw-06ggew.5), set by POSTERN_COMPOSER_SETTINGS with his Talk and Send choices from Me over it
// (talkSettings.ts, mw-06ggew.6): by default hold to talk and let go to send (the words, the voice note and whatever is
// attached go as one message; a slide off keeps the words in the box, unsent), typing,
// any file from the picker, a paste or a drop, a photo from the camera, and the Send arrow beside the bar for files
// with no words. It opens on the text box, the mic standing in for Send until there is something to send.
// What is Postern's own rides on the kit's ways in: the words are this component's (a draft kept per channel, a
// saved prompt's '/name'), whatever he quotes sits on top and leads what he sends, files shared in from another app
// arrive after mount (and bring the bar out when they came with no words), a tap on a waiting picture opens the
// viewer and on any other file opens or downloads it, a picture is cut down on Send, and the send is Postern's.
import { useEffect, useRef, useState } from 'react';
import { Composer as KitComposer, isListenSupported, type ComposerMessage, type ComposerOpen, type WaitingFile } from 'voice-kit/composer';
import { Icon, IconButton, cx, useAlive } from '../ui';
import { useWide } from './hooks';
import { refuseFile, sendToThread, useSend } from './send';
import { toast } from '../ui/toastStore';
import type { ThreadRef } from '../services/threads';
import { takePendingShare } from './shareInbox';
import { quoteBlock } from './quote';
import { usePromptCall } from './usePromptCall';
import { APP_NAME } from './holdBar';
import { useComposerSettings } from './talkSettings';
import { useDraft } from './useDraft';
import { useLiveRoom } from './useLiveRoom';
import { usePictureViewer } from 'pwa-kit/picture-viewer';
import { PosternPictureViewer } from './PosternPictureViewer';
import { openFile } from './openFile';
import { toSent } from './pickedFile';
import { draftsRepo } from '../data/repositories';

/** How long a file's object URL lives after a tap opened or downloaded it: the new tab or the save has read it by then. */
const OPENED_URL_MS = 60_000;

/** A tap on an attached file that is not a picture: the browser's own tab for a PDF or text, a download for any other. */
function openWaiting(blob: Blob, type: string, name: string): void {
  const url = URL.createObjectURL(blob);
  openFile(url, type, name);
  setTimeout(() => URL.revokeObjectURL(url), OPENED_URL_MS);
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
  // What he has typed and not sent waits on the phone, per channel (and per post for a reply), through a lock-out or a reload.
  const draft = useDraft(draftsRepo.keyFor(thread, re), text, (saved) => setText((current) => current || saved), prefill);
  const prompt = usePromptCall(text, setText);
  const settings = useComposerSettings();
  const { run } = useSend();
  const alive = useAlive();
  const viewer = usePictureViewer();
  // On a phone the tab bar sits below the composer and keeps the bottom safe-area inset.
  const wide = useWide();
  const [shared, setShared] = useState<File[]>();
  const [open, setOpen] = useState<ComposerOpen>('box');
  // The kit goes back to `open` after a send: the bar stays out after a send from the bar, as it always has here, the box after one from the box.
  const root = useRef<HTMLDivElement>(null);
  useLiveRoom(root);
  // The files waiting to go that are not pictures, by name: the kit hands a tap back with a URL only for a picture or a voice note.
  const others = useRef(new Map<string, Blob>());

  useEffect(() => {
    const share = takePendingShare();
    if (!share) return;
    // taken once: alive(), not a cancelled flag, so a StrictMode remount (which finds nothing left to take) still gets it
    void Promise.resolve().then(() => {
      if (!alive()) return;
      setShared(share.files.map((file) => new File([file.bytes as BlobPart], file.name, { type: file.type })));
      if (share.text) setText((current) => current || share.text || '');
      // a file shared in with no words: the bar is ready, one hold sends the file with what he says
      else if (isListenSupported()) setOpen('bar');
    });
  }, [alive]);

  function refuse(file: { name: string; type: string; size: number }): string | undefined {
    const refusal = refuseFile(file);
    if (!refusal && file instanceof Blob && !file.type.startsWith('image/')) others.current.set(file.name, file);
    return refusal;
  }

  function tap(file: WaitingFile) {
    const blob = others.current.get(file.name);
    if (file.type.startsWith('image/') && file.preview) viewer.open({ src: file.preview, name: file.name, type: file.type });
    else if (blob) openWaiting(blob, file.type, file.name);
    else if (file.preview) openFile(file.preview, file.type, file.name);
  }

  async function send({ text: words, files }: ComposerMessage): Promise<boolean> {
    const body = `${quote ? quoteBlock(quote) : ''}${words}`;
    const sent = await run(async () => sendToThread(thread, body, await Promise.all(files.map(toSent)), re));
    if (!sent) return false;
    draft.discard();
    others.current.clear();
    if (!alive()) return true;
    setOpen(root.current?.querySelector<HTMLElement>('[data-testid="composer"]')?.dataset.layout === 'bar' ? 'bar' : 'box');
    onClearQuote?.();
    return true;
  }

  return (
    <div ref={root} className="contents">
      <KitComposer
        settings={settings}
        open={open}
        appName={APP_NAME}
        text={text}
        onTextChange={setText}
        onSend={send}
        refuseFile={refuse}
        onNotice={(message) => toast(message, 'error')}
        labels={{ placeholder, view: (name) => (others.current.has(name) ? `Open ${name}` : `View ${name}`) }}
        autoFocus={autoFocus || !!prefill}
        canSendEmpty={!!quote}
        incomingFiles={shared}
        onFileTap={tap}
        onKeyDown={prompt.onKeyDown}
        fieldOverlay={prompt.overlay}
        sendBlocked={prompt.blocked}
        renderSend={prompt.renderSend}
        className={cx(wide && 'pb-safe')}
        top={
          <>
            {quote && (
              <div className="flex items-start gap-2 border-b border-line px-3 py-2 text-[12.5px] text-muted">
                <Icon name="quote" size={14} className="mt-0.5 shrink-0" />
                <p className="line-clamp-2 flex-1">
                  <span className="font-semibold">{quote.speaker}:</span> {quote.text}
                </p>
                <IconButton icon="x" label="Remove quote" size="sm" onClick={onClearQuote} />
              </div>
            )}
            {prompt.top}
          </>
        }
      />
      {viewer.shown && <PosternPictureViewer picture={viewer.shown} onClose={viewer.close} />}
    </div>
  );
}
