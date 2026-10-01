// src/cockpit/NeedCard.tsx — one thing waiting on the Governor (plans/0021
// decision 8), with the Mayor's recommendation as the obvious tap and every
// other answer one tap further. A question is answered (§6), an approval or a
// verification is an action applied at once (§13), a step for his hands or a
// demo is acknowledged on the bead's thread, and anything can be discussed.
import { useMemo, useState } from 'react';
import { Button, Chip, Icon, IconButton, TimeAgo, cx } from '../ui';
import { Markdown } from '../markdown';
import { NEED_META, VERIFY_BUTTON } from './labels';
import { beadHref, type Route } from '../nav/route';
import { GENERAL, titleFor } from '../model/threads';
import type { TalkAbout } from '../model/talkLine';
import { navigate } from '../router';
import { threadKey } from '../services/threads';
import { sendAction, sendAnswer, sendToThread, useSend } from './send';
import { speak } from '../services/speech';
import type { Need } from '../model/view';
import { answeredByComment, answeredInWords, orderedOptions, releaseState, waitsFor, waitsOnLinks } from '../model/needs';
import type { ViewIndex } from '../model/tree';
import { HandsSteps } from './HandsSteps';
import { useOneTap } from './oneTap';
import { useAnswers, useBeadTitles, useOutbox, useStoredComments, useThreadMessages } from './hooks';
import { pendingAnswer } from '../model/outbox';
import { OutboxMark } from './OutboxMark';
import { clockTime } from '../services/age';
import { WaitingNote } from './WaitingNote';
import { StaleChoice } from './StaleChoice';

export interface NeedCardProps {
  need: Need;
  epicTitle?: string;
  compact?: boolean;
  /** The live view, so what a card waits on can link to those beads. */
  index?: ViewIndex;
  /** The bead's status from its loaded detail, fresher than the view's; the view's is used without it. */
  status?: string;
}

/** What a Talk from this card is about: its bead, or the Factory channel for a card with none. */
function aboutNeed(need: Need): TalkAbout {
  return need.bead ? { kind: 'bead', id: need.bead, title: need.title || need.bead } : { kind: 'channel', id: GENERAL, title: need.title || titleFor(GENERAL).title };
}

function spokenText(need: Need): string {
  const parts = [`${NEED_META[need.kind].verb}: ${need.title}.`];
  if (need.text && need.text !== need.title) parts.push(need.text);
  if (need.recommended) parts.push(`The Mayor recommends ${need.recommended}.`);
  return parts.join(' ');
}

/** A question's own first line (Markdown marks off), and the rest of what it says. */
function questionWords(text: string): { headline: string; rest: string } {
  const lines = text.split('\n');
  const at = lines.findIndex((line) => line.trim() !== '');
  if (at < 0) return { headline: '', rest: '' };
  const headline = lines[at].replace(/^[\s#>]+/, '').replace(/\*\*|__/g, '').trim();
  return { headline, rest: lines.slice(at + 1).join('\n').trim() };
}

export function NeedCard({ need, epicTitle, compact, index, status }: NeedCardProps) {
  const titles = useBeadTitles();
  const meta = NEED_META[need.kind];
  const { busy, run } = useSend();
  // An approval or a verification is one signed transaction: one tap, then it waits for the view.
  const tapAction = waitsFor(need) !== 'you' || need.not_ready ? '' : need.kind === 'approve' ? 'release' : need.kind === 'verify' ? 'verified' : '';
  const oneTap = useOneTap(tapAction ? need.bead : '', tapAction);
  // Release is for a story still held, as on the bead's page; a known status that is not held says so instead of offering it.
  const releaseNow = tapAction === 'release' ? releaseState(need, index, status) : 'held';
  const released = releaseNow === 'building' || releaseNow === 'released' || releaseNow === 'empty';
  // A question is answered once: his tap (an option or his own words) sends one answer, then the card is dead
  // until the view drops it. One state per question, so a later question on the bead is not held by this one.
  const asks = need.kind === 'question' && need.bead !== '';
  const answerTap = useOneTap(asks ? need.bead : '', `answer:${need.since}`);
  // What he sent is on this phone's own record too: the card stays dead across a reload and a view refetch.
  const sentRow = useAnswers().find((row) => row.bead === need.bead && row.ts * 1000 >= Date.parse(need.since));
  // An answer the factory has heard (a card_answered event, §22, on the view's copy) is dead too, whichever device sent it.
  const heard = need.answered;
  // An answer still in the outbox (mw-jrx0s.10) is dead and says so too: it is marked pending until it has gone.
  const outbox = useOutbox();
  const pendingRow = asks ? pendingAnswer(outbox, need.bead, Date.parse(need.since)) : undefined;
  // Words count as an answer too (mw-gq6.199): typed in the bead's thread or in Factory naming an option, or an ANSWER comment on the bead.
  const inBeadThread = useThreadMessages(asks ? threadKey({ bead: need.bead }) : undefined);
  const inFactory = useThreadMessages(undefined);
  const comments = useStoredComments(asks ? need.bead : '');
  const soleQuestion = index !== undefined && index.view.needs.filter((n) => n.kind === 'question' && n.bead !== '').length === 1;
  const inWords = useMemo(
    () => (asks ? (answeredByComment(need, comments) ?? answeredInWords(need, [...inBeadThread, ...inFactory], outbox, soleQuestion)) : undefined),
    [asks, need, comments, inBeadThread, inFactory, outbox, soleQuestion],
  );
  const answered = asks && (answerTap.waiting || sentRow !== undefined || heard !== undefined || pendingRow !== undefined || inWords !== undefined);
  const saidWhat = answerTap.said
    ? { label: answerTap.said.label, at: answerTap.said.at }
    : pendingRow
      ? { label: pendingRow.label ?? '', at: pendingRow.created }
      : sentRow
      ? { label: sentRow.answer, at: sentRow.ts * 1000 }
      : heard
        ? { label: heard.option, at: Date.parse(heard.at) }
        : inWords;
  const [notSent, setNotSent] = useState(false);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState('');
  const [expanded, setExpanded] = useState(false);

  // A card waiting on the Mayor or the factory offers him nothing to tap but Reply and Open.
  const waiter = waitsFor(need);
  const waiting = waiter !== 'you';
  // A not_ready card, whoever's turn it is, offers neither Release nor Done: its steps show with what they wait on.
  const notReady = waiting || need.not_ready === true;
  const hasSteps = need.kind === 'hands' && need.steps.length > 0;
  const stale = need.kind === 'stale';
  // A stale need has its own Keep and Close (StaleChoice); the bead's page offers them among its actions.
  const options = notReady || hasSteps || stale || released ? [] : orderedOptions(need);
  const thread = need.bead ? { bead: need.bead } : undefined;
  // Where a message from this card lands, so the toast can name it and open it.
  const threadName = need.bead || titleFor(GENERAL).title;
  const openThread: Route = { view: 'talk', thread: threadKey(thread) ?? GENERAL };

  async function choose(option: string) {
    if (asks) {
      setNotSent(false);
      if ((await answerTap.tap(() => sendAnswer(need.bead, option), { text: `Answered ${need.bead}: ${option}`, open: openThread }, option)) === undefined) setNotSent(true);
    }
    else if (need.kind === 'question') await run(() => sendAnswer(need.bead, option), { text: `Answered ${need.bead}: ${option}`, open: openThread });
    else if (need.kind === 'approve') await oneTap.tap(() => sendAction({ action: 'release', bead: need.bead }), `Released ${need.bead}`);
    else if (need.kind === 'verify') await oneTap.tap(() => sendAction({ action: 'verified', bead: need.bead }), `Marked ${need.bead} verified`);
    else await run(() => sendToThread(thread, option), { text: `Told the Mayor in ${threadName}: ${option}`, open: openThread });
  }

  async function sendReply() {
    const text = reply.trim();
    if (!text) return;
    setNotSent(false);
    const sent =
      need.kind === 'question'
        ? await (asks ? answerTap.tap(() => sendAnswer(need.bead, text), { text: `Answered ${need.bead}`, open: openThread }, text) : run(() => sendAnswer(need.bead, text), { text: `Answered ${need.bead}`, open: openThread }))
        : await run(() => sendToThread(thread, text), { text: `Sent to the Mayor in ${threadName}`, open: openThread });
    if (asks && sent === undefined) setNotSent(true);
    if (sent) {
      setReply('');
      setReplying(false);
    }
  }

  // A stale need's text is the facts the choice rests on: never clipped, and shown on the bead's page too.
  // A question is headed by its own first line, so a second question on the bead does not read as the first.
  const words = need.kind === 'question' ? questionWords(need.text) : undefined;
  const asked = words !== undefined && words.headline !== '';
  const body = asked ? words.rest : need.text;
  // A verify card's text is its HOW TO CHECK IT steps: shown in full, on the bead's page too, under their own heading.
  const verifySteps = need.kind === 'verify' && body.trim() !== '';
  const long = body.length > 280 && !stale && !verifySteps;
  return (
    <article
      className={cx('flex min-w-0 flex-col gap-3 overflow-hidden rounded-2xl border border-line bg-surface p-4', need.kind === 'alarm' && 'border-danger/40')}
      data-testid="need-card"
      aria-label={`${meta.label}: ${need.title}`}
    >
      <div className="flex items-center gap-2">
        <Chip tone={meta.tone} icon={meta.icon}>
          {meta.label}
        </Chip>
        {waiting && (
          <Chip tone="neutral" icon="clock">
            {waiter === 'mayor' ? 'Waits on the Mayor' : 'Waits on the factory'}
          </Chip>
        )}
        {epicTitle && <span className="min-w-0 truncate text-[12px] text-muted">{epicTitle}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-2 text-[12px] text-faint">
          {need.blocks > 0 && (
            <span title={`${need.blocks} beads wait on this`} className="inline-flex items-center gap-1">
              <Icon name="layers" size={13} />
              {need.blocks}
            </span>
          )}
          {!asked && <TimeAgo at={need.since} />}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {asked && (
          <>
            <h3 className="text-[16px] leading-snug font-semibold">{words.headline}</h3>
            <span className="text-[12px] text-faint">
              asked <TimeAgo at={need.since} />
            </span>
          </>
        )}
        {need.bead ? (
          <a href={beadHref(need.bead)} className={asked ? 'text-[13px] text-muted hover:underline' : 'text-[16px] leading-snug font-semibold hover:underline'}>
            {need.title || need.bead}
          </a>
        ) : (
          <p className={asked ? 'text-[13px] text-muted' : 'text-[16px] leading-snug font-semibold'}>{need.title}</p>
        )}
        {need.bead && <span className="font-mono text-[11.5px] text-faint">{need.bead}</span>}
      </div>

      {body && (asked || need.text !== need.title) && (!compact || stale || asked || verifySteps) && (
        <div
          className={cx('relative text-muted', !expanded && long && 'max-h-40 overflow-hidden', verifySteps && 'flex flex-col gap-1 [&_img]:h-auto [&_img]:w-full')}
          data-testid={verifySteps ? 'verify-steps' : undefined}
        >
          {verifySteps && <h4 className="text-[13px] font-semibold text-fg">How to check it</h4>}
          <Markdown text={body} />
          {!expanded && long && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-surface pt-8 text-left text-[13px] font-medium text-fg"
            >
              Read all
            </button>
          )}
        </div>
      )}

      {notReady && !hasSteps && need.waiting_on && need.waiting_on.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-[13px] text-muted" aria-label="Waiting on">
          {need.waiting_on.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}

      {hasSteps && <HandsSteps bead={need.bead} title={need.title} steps={need.steps} waitsOn={notReady ? waitsOnLinks(need, index, beadHref) : undefined} />}

      {stale && !waiting && !compact && need.bead && <StaleChoice bead={need.bead} />}

      {/* On the bead's page (compact) the Actions row already says there are no stories. */}
      {released && !(releaseNow === 'empty' && compact) && (
        <p role="status" className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
          <Icon name="check" size={15} className="shrink-0" />
          {releaseNow === 'building' ? 'Already released: building' : releaseNow === 'empty' ? 'No stories yet: the Mayor drafts them.' : 'Already released'}
        </p>
      )}

      {tapAction && oneTap.waiting && !released && <WaitingNote pending={oneTap.pending} queued={oneTap.queued} />}

      {answered && saidWhat && (
        <p role="status" className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
          <Icon name="check" size={15} className="shrink-0" />
          <span className="min-w-0 truncate">
            {saidWhat.label ? `Answered: ${saidWhat.label}` : 'Answered'} {clockTime(new Date(saidWhat.at))}
          </span>
          {pendingRow && <OutboxMark row={pendingRow} />}
        </p>
      )}

      {asks && notSent && !answered && (
        <p role="alert" className="text-[13px] text-danger">
          Your answer did not send. Tap an option to try again.
        </p>
      )}

      {options.length > 0 && !(tapAction && oneTap.waiting) && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Answers">
          {options.map((option) => {
            const recommended = option === need.recommended && options.length > 1;
            const words = need.kind === 'verify' ? VERIFY_BUTTON : option;
            return (
              <Button
                key={option}
                variant={recommended || options.length === 1 ? 'primary' : 'secondary'}
                onClick={() => void choose(option)}
                disabled={busy || answered}
                className="max-w-full"
                aria-label={recommended ? `${words} (recommended)` : words}
              >
                <span className="truncate">{words}</span>
                {recommended && <span className="text-[11px] font-medium opacity-75">recommended</span>}
              </Button>
            );
          })}
        </div>
      )}

      {replying && (
        <div className="flex flex-col gap-2">
          <textarea
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            rows={3}
            aria-label="Your reply"
            placeholder={need.kind === 'question' ? 'Answer in your own words…' : 'Tell the Mayor…'}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setReplying(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" icon="send" busy={busy} disabled={!reply.trim() || answered} onClick={() => void sendReply()}>
              Send
            </Button>
          </div>
        </div>
      )}

      <div className="-mb-1 flex items-center gap-1 border-t border-line pt-2">
        {!replying && (
          <Button variant="ghost" size="sm" icon="talk" disabled={answered} onClick={() => setReplying(true)}>
            {need.kind === 'question' ? 'Answer in words' : 'Reply'}
          </Button>
        )}
        <Button variant="ghost" size="sm" icon="mic" onClick={() => navigate({ view: 'line', about: aboutNeed(need) })}>
          Talk
        </Button>
        {need.bead && (
          <a href={beadHref(need.bead)} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm text-muted hover:bg-raised hover:text-fg">
            <Icon name="forward" size={16} />
            Open
          </a>
        )}
        <IconButton icon="speaker" label="Read aloud" size="sm" className="ml-auto" onClick={() => speak(spokenText(need), { titles })} />
      </div>
    </article>
  );
}
