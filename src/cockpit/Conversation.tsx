// src/cockpit/Conversation.tsx — a thread as a conversation (plans/0021 decision
// 10): his words on the right, the Mayor's on the left, Builders' comments
// marked as theirs; each with who and when, Markdown rendered, a question with
// its answers tappable in place, a voice note playable with what was heard in
// it, an image shown, a file openable, and the Mayor's words readable aloud.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Chip, Icon, IconButton, cx } from '../ui';
import { Markdown } from '../markdown';
import { answersGiven, askedAgainAt, attachmentLabel, type ConversationItem, type GivenAnswer } from '../model/conversation';
import { answeredQuestion, needOfQuestion } from '../model/needs';
import { clockTime } from '../services/age';
import { openAttachment } from '../services/blobs';
import { useLive } from '../services/live';
import { isSupported as canSpeak, speak, stop as stopSpeaking } from '../services/speech';
import { useSpeaking } from './useSpeaking';
import { useAnswers, useBeadTitles, useOutbox, useStoredComments, useThreadMessages, useUnlockedKey, useViewIndex } from './hooks';
import { pendingAnswer } from '../model/outbox';
import { FailedNote, OutboxMark } from './OutboxMark';
import { PendingMark } from './PendingMark';
import { ShareButton } from './ShareButton';
import { VoicePlayer } from './VoicePlayer';
import { messageShareText } from '../model/shareText';
import { sendAnswer } from './send';
import { useOneTap } from './oneTap';
import { threadKey, type Attachment } from '../services/threads';

function dayLabel(at: number): string {
  const date = new Date(at);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/** How far outside the scroll box (or the screen) a file may be and still load: about a screen ahead. */
const LOAD_AHEAD = '600px 0px';

/** Whether `ref`'s element has come near the viewport (its scroll box, or the screen), and stays so once it has.
 * Where the browser has no IntersectionObserver every file counts as near and loads at once. */
function useNearViewport(): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && setNear(true), { root: scrollBoxOf(el), rootMargin: LOAD_AHEAD });
    observer.observe(el);
    return () => observer.disconnect();
  }, [near]);
  return [ref, near];
}

/** One file: loaded only once it nears the viewport (mw-gq6.284), a placeholder until then. */
function AttachmentView({ attachment, direction }: { attachment: Attachment; direction: 'sent' | 'received' }) {
  const [ref, near] = useNearViewport();
  return (
    <div ref={ref}>
      <AttachmentBody attachment={attachment} direction={direction} near={near} />
    </div>
  );
}

/** Saves an object URL as a file of this name: the tap on a file the app does not show. */
function download(url: string, name: string | undefined): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = name ?? 'file';
  link.rel = 'noopener';
  link.click();
}

function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function AttachmentBody({ attachment, direction, near }: { attachment: Attachment; direction: 'sent' | 'received'; near: boolean }) {
  const key = useUnlockedKey();
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const inline = attachment.mime.startsWith('image/') || attachment.mime.startsWith('audio/');
  // A type the browser shows (a PDF, plain text) opens in a tab; any other file downloads.
  const shown = inline || attachment.mime === 'application/pdf' || attachment.mime === 'text/plain';
  const { reconnects } = useLive();
  // A failed load is tried again by itself once, when the stream reconnects or
  // the app returns to the foreground; after that it waits for a tap on Retry.
  const autoRetried = useRef(false);
  const failed = useRef(false);
  const seenReconnects = useRef(reconnects);

  useEffect(() => {
    if (!key || !inline || !near) return;
    let cancelled = false;
    openAttachment(attachment, { key, direction })
      .then((opened) => {
        if (cancelled) return;
        failed.current = false;
        setUrl(opened);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        failed.current = true;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [attachment, direction, key, inline, near, attempt]);

  function retry(automatic: boolean) {
    if (automatic) {
      if (!failed.current || autoRetried.current) return;
      autoRetried.current = true;
    } else {
      autoRetried.current = false;
    }
    failed.current = false;
    setError(undefined);
    setAttempt((n) => n + 1);
  }

  useEffect(() => {
    if (seenReconnects.current === reconnects) return;
    seenReconnects.current = reconnects;
    retry(true);
  }, [reconnects]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') retry(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  async function open() {
    if (!key) return;
    try {
      const opened = url ?? (await openAttachment(attachment, { key, direction }));
      if (shown) window.open(opened, '_blank', 'noopener');
      else download(opened, attachment.name);
    } catch (err) {
      failed.current = true;
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-danger">
        <span>Could not load this file: {error}</span>
        <Button size="sm" variant="secondary" onClick={() => retry(false)}>
          Retry
        </Button>
      </div>
    );
  }
  if (attachment.mime.startsWith('image/')) {
    return url ? (
      <button type="button" onClick={() => void open()} className="block overflow-hidden rounded-xl">
        <img src={url} alt="Attached image" className="max-h-80 w-auto max-w-full object-contain" />
      </button>
    ) : (
      <div className="flex h-40 w-56 max-w-full items-center justify-center rounded-xl bg-sunken text-faint">
        <Icon name="image" size={24} />
      </div>
    );
  }
  if (attachment.mime.startsWith('audio/')) {
    return url ? <VoicePlayer src={url} /> : <div className="h-10 w-64 animate-pulse rounded-full bg-sunken" />;
  }
  return (
    <button type="button" onClick={() => void open()} className="inline-flex items-center gap-2 rounded-xl border border-line bg-sunken px-3 py-2 text-sm hover:border-line-strong">
      <Icon name="file" size={18} />
      <span className="min-w-0 truncate">{attachment.name ?? attachmentLabel(attachment)}</span> · {fileSize(attachment.size)}
    </button>
  );
}

/** Every file of one message: a lone file as it always was; several, images two to a row. */
function AttachmentList({ attachments, direction }: { attachments: Attachment[]; direction: 'sent' | 'received' }) {
  if (attachments.length === 1) {
    return (
      <div className="mb-1.5">
        <AttachmentView attachment={attachments[0]} direction={direction} />
      </div>
    );
  }
  return (
    <div className="mb-1.5 grid grid-cols-2 gap-1.5" data-testid="attachment-list">
      {attachments.map((file, i) => (
        <div key={`${file.hash}:${i}`} className={file.mime.startsWith('image/') ? 'min-w-0' : 'col-span-2'}>
          <AttachmentView attachment={file} direction={direction} />
        </div>
      ))}
    </div>
  );
}

/** Options this short stay a row of pills; any longer one stacks them all as full-width wrapped buttons. */
const SHORT_OPTION = 40;

/** 'A: words' as a bold 'A:' and the words; any other option is its own text. */
function OptionLabel({ option }: { option: string }) {
  const lettered = /^([A-Za-z0-9]{1,2}:)\s+([\s\S]*)$/.exec(option);
  if (!lettered) return <>{option}</>;
  return (
    <>
      <strong className="font-bold">{lettered[1]}</strong> {lettered[2]}
    </>
  );
}

/** A question is answered once: his tap sends one answer, then the options go dead and the card says what he
 * answered and when. The answer he sent (the app's own record of it) is the truth, so it reads the same after a
 * reload; a send that failed leaves the options tappable and says so. His words naming an option and the
 * factory's ANSWER comment count too (mw-gq6.214), as on Needs you, whether or not they sit in this thread.
 * `until` is when the bead asked again (ms), where the words for this question end. */
function QuestionBlock({ item, given, until }: { item: ConversationItem; given?: GivenAnswer; until?: number }) {
  const question = item.question;
  const tapped = useOneTap(question?.bead ?? '', `answer:${item.id}`);
  const [failed, setFailed] = useState(false);
  const outbox = useOutbox();
  const asks = question !== undefined && question.bead !== '';
  const inBeadThread = useThreadMessages(asks ? threadKey({ bead: question.bead }) : undefined);
  const inFactory = useThreadMessages(undefined);
  const comments = useStoredComments(asks ? question.bead : '');
  const sent = useAnswers();
  const view = useViewIndex();
  // Words in Factory that name no bead answer this card only when it is the one question open.
  const open = view?.index.view.needs.filter((need) => need.kind === 'question' && need.bead !== '') ?? [];
  const soleQuestion = open.length === 1 && open[0].bead === question?.bead;
  const inWords = useMemo(
    () => (question && asks ? answeredQuestion(needOfQuestion(question, item.at), { sent, comments, messages: [...inBeadThread, ...inFactory], outbox, soleQuestion }, until) : undefined),
    [question, asks, item.at, sent, comments, inBeadThread, inFactory, outbox, soleQuestion, until],
  );
  if (!question) return null;
  // An answer still in the outbox (mw-jrx0s.10) is dead and says so too: it is marked pending until it has gone.
  const queued = pendingAnswer(outbox, question.bead, item.at);
  const answered = given ?? (tapped.said ? { answer: tapped.said.label, at: tapped.said.at } : queued ? { answer: queued.label ?? '', at: queued.created } : inWords ? { answer: inWords.label, at: inWords.at } : undefined);
  const dead = answered !== undefined || tapped.waiting;
  const stacked = question.options.some((option) => option.length >= SHORT_OPTION);

  async function choose(option: string) {
    if (dead) return;
    setFailed(false);
    const sent = await tapped.tap(() => sendAnswer(question!.bead, option), `Answered: ${option}`, option);
    if (sent === undefined) setFailed(true);
  }

  return (
    <>
      <div className={cx('mt-2 flex gap-2', stacked ? 'flex-col' : 'flex-wrap')}>
        {question.options.map((option) => (
          <Button
            key={option}
            size="sm"
            wrap={stacked}
            variant={option === question.rec ? 'primary' : 'secondary'}
            disabled={dead}
            onClick={() => void choose(option)}
          >
            {stacked ? (
              <span className="min-w-0">
                <OptionLabel option={option} />
                {option === question.rec && <span className="ml-1.5 text-[10.5px] font-normal opacity-75">rec.</span>}
              </span>
            ) : (
              <>
                {option}
                {option === question.rec && <span className="text-[10.5px] opacity-75">rec.</span>}
              </>
            )}
          </Button>
        ))}
      </div>
      {answered && (
        <p role="status" className="mt-2 inline-flex min-w-0 items-start gap-1.5 text-[13px] text-muted">
          <Icon name="check" size={15} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">
            Answered: {answered.answer} {clockTime(new Date(answered.at))}
          </span>
          {queued && <OutboxMark row={queued} />}
        </p>
      )}
      {failed && !dead && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          Your answer did not send. Tap an option to try again.
        </p>
      )}
    </>
  );
}

function Bubble({ item, given, until, shareTitle, onQuote, onReply }: { item: ConversationItem; given?: GivenAnswer; until?: number; shareTitle: string; onQuote?: (item: ConversationItem) => void; onReply?: (item: ConversationItem) => void }) {
  const titles = useBeadTitles();
  const speakKey = `message:${item.id}`;
  const reading = useSpeaking(speakKey);
  const mine = item.speaker === 'you';
  const shared = messageShareText(item);
  const builder = item.speaker === 'builder' || item.speaker === 'factory' || item.speaker === 'other';
  if (item.kind === 'action' || item.kind === 'answer') {
    return (
      <div className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
        <Chip wrap tone={item.kind === 'answer' ? 'needs' : 'done'} icon={item.kind === 'answer' ? 'check' : 'release'}>
          {item.kind === 'answer' ? `${item.speakerLabel} answered: ${item.text}` : item.text}
        </Chip>
      </div>
    );
  }
  return (
    <div className={cx('group flex flex-col', mine ? 'items-end' : 'items-start')} data-testid="message">
      <div
        className={cx(
          'relative max-w-[88%] rounded-2xl px-3.5 py-2.5 lg:max-w-[75%]',
          mine ? 'rounded-br-md bg-mine' : 'rounded-bl-md border border-line bg-theirs',
          builder && 'border-dashed',
          item.pending && 'opacity-60',
        )}
      >
        {!mine && <p className={cx('mb-0.5 text-[11.5px] font-semibold', item.speaker === 'mayor' ? 'text-accent' : 'text-muted')}>{item.speakerLabel}</p>}
        {item.attachments && item.attachments.length > 0 && <AttachmentList attachments={item.attachments} direction={mine ? 'sent' : 'received'} />}
        {item.text && <Markdown text={item.text} wrap />}
        {item.transcript !== undefined && (
          <p className="mt-1.5 border-l-2 border-line-strong pl-2 text-[13px] text-muted">
            <span className="font-semibold">Heard:</span> {item.transcript}
          </p>
        )}
        {item.kind === 'question' && <QuestionBlock item={item} given={given} until={until} />}
      </div>
      <div className="mt-0.5 flex items-center gap-1 px-1 text-[11px] text-faint">
        <span>{item.onChain ? `Sent on chain ${clockTime(new Date(item.at))}` : clockTime(new Date(item.at))}</span>
        {item.pending && (item.failure !== undefined && item.outboxId !== undefined ? <FailedNote id={item.outboxId} failure={item.failure} /> : <PendingMark />)}
        {item.unread && <span className="font-semibold text-accent">· new</span>}
        {item.speaker !== 'you' && item.text && canSpeak() && (
          <button
            type="button"
            aria-label={reading ? 'Stop reading' : 'Read aloud'}
            className="rounded p-0.5 hover:text-fg"
            onClick={() => (reading ? stopSpeaking() : speak(item.text, { titles, key: speakKey }))}
          >
            <Icon name={reading ? 'stop' : 'speaker'} size={13} />
          </button>
        )}
        {onReply && item.txid && (item.kind === 'text' || item.kind === 'attachment') && (
          <button type="button" className="rounded px-1 font-semibold text-muted hover:text-fg" onClick={() => onReply(item)}>
            Reply
          </button>
        )}
        {shared && <ShareButton title={shareTitle} text={shared} />}
        {onQuote && item.text && (
          <button type="button" aria-label="Quote this" className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:text-fg focus:opacity-100" onClick={() => onQuote(item)}>
            <Icon name="quote" size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

/** The nearest ancestor that scrolls on its own, or null when only the page does. The page is never
 * one: html and body are overflow:hidden but can still be moved by a script, and on a phone with its
 * keyboard open that leaves the screen pushed up (mw-jkrnxu.1). */
function scrollBoxOf(el: HTMLElement): HTMLElement | null {
  for (let up = el.parentElement; up && up !== document.body && up !== document.documentElement; up = up.parentElement) {
    const { overflowY } = getComputedStyle(up);
    if (overflowY === 'auto' || overflowY === 'scroll') return up;
  }
  return null;
}

export function Conversation({
  items,
  onQuote,
  onReply,
  footer,
  empty,
  className,
  scrollOnOpen = true,
  shareTitle = 'Postern',
}: {
  items: ConversationItem[];
  onQuote?: (item: ConversationItem) => void;
  /** Shows a Reply button on a message that can be answered in a thread of its own (General). */
  onReply?: (item: ConversationItem) => void;
  /** What sits under an item's bubble: General's 'N replies' row. */
  footer?: (item: ConversationItem) => React.ReactNode;
  empty?: React.ReactNode;
  className?: string;
  /** Scroll to the newest message when first shown; always scroll on a new one.
   * Off where the conversation sits under other content (a bead on a phone). */
  scrollOnOpen?: boolean;
  /** The title Share gives the phone's share sheet: shareTitle() of the channel this conversation is in. */
  shareTitle?: string;
}) {
  const end = useRef<HTMLDivElement>(null);
  const seen = useRef<number | null>(null);
  const count = items.length;
  useLayoutEffect(() => {
    const first = seen.current === null;
    if ((first && scrollOnOpen) || (!first && count > (seen.current ?? 0))) {
      // Move the conversation's own scroll box, never an ancestor outside it (what scrollIntoView does).
      const box = end.current && scrollBoxOf(end.current);
      if (box) box.scrollTop = box.scrollHeight;
    }
    seen.current = count;
  }, [count, scrollOnOpen]);

  const given = useMemo(() => answersGiven(items), [items]);
  const askedAgain = useMemo(() => askedAgainAt(items), [items]);
  if (count === 0) return <div className={className}>{empty}</div>;
  const days = items.map((item) => dayLabel(item.at));
  return (
    <div className={cx('message-list flex flex-col gap-3', className)} data-testid="conversation">
      {items.map((item, i) => {
        const day = days[i];
        const showDay = i === 0 || day !== days[i - 1];
        return (
          <div key={item.id} className="flex flex-col gap-3">
            {showDay && (
              <div className="flex items-center gap-3 py-1 text-[11px] font-semibold tracking-wide text-faint uppercase">
                <span className="h-px flex-1 bg-line" />
                {day}
                <span className="h-px flex-1 bg-line" />
              </div>
            )}
            <Bubble item={item} given={given.get(item.id)} until={askedAgain.get(item.id)} shareTitle={shareTitle} onQuote={onQuote} onReply={onReply} />
            {footer?.(item)}
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}

export function SpeakAll({ items }: { items: ConversationItem[] }) {
  const titles = useBeadTitles();
  const reading = useSpeaking('last-mayor-message');
  const last = [...items].reverse().find((item) => item.speaker === 'mayor' && item.text);
  if (!last || !canSpeak()) return null;
  return (
    <IconButton
      icon={reading ? 'stop' : 'speaker'}
      label={reading ? 'Stop reading' : "Read the Mayor's last message aloud"}
      onClick={() => (reading ? stopSpeaking() : speak(last.text, { titles, key: 'last-mayor-message' }))}
    />
  );
}
