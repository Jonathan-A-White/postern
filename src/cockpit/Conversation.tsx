// src/cockpit/Conversation.tsx — a thread as a conversation (plans/0021 decision
// 10): his words on the right, the Mayor's on the left, Builders' comments
// marked as theirs; each with who and when, Markdown rendered, a question with
// its answers tappable in place, a voice note playable with what was heard in
// it, an image shown, a file openable, and the Mayor's words readable aloud.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Chip, Icon, IconButton, cx } from '../ui';
import { Markdown } from '../markdown';
import { answersGiven, attachmentLabel, type ConversationItem, type GivenAnswer } from '../model/conversation';
import { clockTime } from '../services/age';
import { openAttachment } from '../services/blobs';
import { useLive } from '../services/live';
import { speak } from '../services/speech';
import { useOutbox, useUnlockedKey } from './hooks';
import { pendingAnswer } from '../model/outbox';
import { PendingMark } from './PendingMark';
import { VoicePlayer } from './VoicePlayer';
import { sendAnswer } from './send';
import { useOneTap } from './oneTap';
import type { Attachment } from '../services/threads';

function dayLabel(at: number): string {
  const date = new Date(at);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function AttachmentView({ attachment, direction }: { attachment: Attachment; direction: 'sent' | 'received' }) {
  const key = useUnlockedKey();
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const inline = attachment.mime.startsWith('image/') || attachment.mime.startsWith('audio/');
  const { reconnects } = useLive();
  // A failed load is tried again by itself once, when the stream reconnects or
  // the app returns to the foreground; after that it waits for a tap on Retry.
  const autoRetried = useRef(false);
  const failed = useRef(false);
  const seenReconnects = useRef(reconnects);

  useEffect(() => {
    if (!key || !inline) return;
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
  }, [attachment, direction, key, inline, attempt]);

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
      window.open(opened, '_blank', 'noopener');
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
      {attachmentLabel(attachment)} · {Math.max(1, Math.round(attachment.size / 1024))} KB
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
 * reload; a send that failed leaves the options tappable and says so. */
function QuestionBlock({ item, given }: { item: ConversationItem; given?: GivenAnswer }) {
  const question = item.question;
  const tapped = useOneTap(question?.bead ?? '', `answer:${item.id}`);
  const [failed, setFailed] = useState(false);
  const outbox = useOutbox();
  if (!question) return null;
  // An answer still in the outbox (mw-jrx0s.10) is dead and says so too: it is marked pending until it has gone.
  const queued = pendingAnswer(outbox, question.bead, item.at);
  const answered = given ?? (tapped.said ? { answer: tapped.said.label, at: tapped.said.at } : queued ? { answer: queued.label ?? '', at: queued.created } : undefined);
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
          {queued && <PendingMark />}
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

function Bubble({ item, given, onQuote, onReply }: { item: ConversationItem; given?: GivenAnswer; onQuote?: (item: ConversationItem) => void; onReply?: (item: ConversationItem) => void }) {
  const mine = item.speaker === 'you';
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
        {item.kind === 'question' && <QuestionBlock item={item} given={given} />}
      </div>
      <div className="mt-0.5 flex items-center gap-1 px-1 text-[11px] text-faint">
        <span>{clockTime(new Date(item.at))}</span>
        {item.pending && <PendingMark />}
        {item.unread && <span className="font-semibold text-accent">· new</span>}
        {item.speaker !== 'you' && item.text && (
          <button type="button" aria-label="Read aloud" className="rounded p-0.5 hover:text-fg" onClick={() => speak(item.text)}>
            <Icon name="speaker" size={13} />
          </button>
        )}
        {onReply && item.txid && (item.kind === 'text' || item.kind === 'attachment') && (
          <button type="button" className="rounded px-1 font-semibold text-muted hover:text-fg" onClick={() => onReply(item)}>
            Reply
          </button>
        )}
        {onQuote && item.text && (
          <button type="button" aria-label="Quote this" className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:text-fg focus:opacity-100" onClick={() => onQuote(item)}>
            <Icon name="quote" size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

export function Conversation({
  items,
  onQuote,
  onReply,
  footer,
  empty,
  className,
  scrollOnOpen = true,
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
}) {
  const end = useRef<HTMLDivElement>(null);
  const seen = useRef<number | null>(null);
  const count = items.length;
  useLayoutEffect(() => {
    const first = seen.current === null;
    if ((first && scrollOnOpen) || (!first && count > (seen.current ?? 0))) end.current?.scrollIntoView?.({ block: 'end' });
    seen.current = count;
  }, [count, scrollOnOpen]);

  const given = useMemo(() => answersGiven(items), [items]);
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
            <Bubble item={item} given={given.get(item.id)} onQuote={onQuote} onReply={onReply} />
            {footer?.(item)}
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}

export function SpeakAll({ items }: { items: ConversationItem[] }) {
  const last = [...items].reverse().find((item) => item.speaker === 'mayor' && item.text);
  if (!last) return null;
  return <IconButton icon="speaker" label="Read the Mayor's last message aloud" onClick={() => speak(last.text)} />;
}
