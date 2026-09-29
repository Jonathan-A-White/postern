// src/cockpit/NeedCard.tsx — one thing waiting on the Governor (plans/0021
// decision 8), with the Mayor's recommendation as the obvious tap and every
// other answer one tap further. A question is answered (§6), an approval or a
// verification is an action applied at once (§13), a step for his hands or a
// demo is acknowledged on the bead's thread, and anything can be discussed.
import { useState } from 'react';
import { Button, Chip, Icon, IconButton, TimeAgo, cx } from '../ui';
import { Markdown } from '../markdown';
import { NEED_META } from './labels';
import { beadHref, type Route } from '../nav/route';
import { GENERAL, titleFor } from '../model/threads';
import { threadKey } from '../services/threads';
import { sendAction, sendAnswer, sendToThread, useSend } from './send';
import { speak } from '../services/speech';
import type { Need } from '../model/view';
import { orderedOptions } from '../model/needs';
import { HandsSteps } from './HandsSteps';

export interface NeedCardProps {
  need: Need;
  epicTitle?: string;
  compact?: boolean;
}

function spokenText(need: Need): string {
  const parts = [`${NEED_META[need.kind].verb}: ${need.title}.`];
  if (need.text && need.text !== need.title) parts.push(need.text);
  if (need.recommended) parts.push(`The Mayor recommends ${need.recommended}.`);
  return parts.join(' ');
}

export function NeedCard({ need, epicTitle, compact }: NeedCardProps) {
  const meta = NEED_META[need.kind];
  const { busy, run } = useSend();
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState('');
  const [expanded, setExpanded] = useState(false);

  const hasSteps = need.kind === 'hands' && need.steps.length > 0;
  const options = hasSteps ? [] : orderedOptions(need);
  const thread = need.bead ? { bead: need.bead } : undefined;
  // Where a message from this card lands, so the toast can name it and open it.
  const threadName = need.bead || titleFor(GENERAL).title;
  const openThread: Route = { view: 'talk', thread: threadKey(thread) ?? GENERAL };

  async function choose(option: string) {
    if (need.kind === 'question') await run(() => sendAnswer(need.bead, option), { text: `Answered ${need.bead}: ${option}`, open: openThread });
    else if (need.kind === 'approve') await run(() => sendAction({ action: 'release', bead: need.bead }), `Released ${need.bead}`);
    else if (need.kind === 'verify') await run(() => sendAction({ action: 'verified', bead: need.bead }), `Marked ${need.bead} verified`);
    else await run(() => sendToThread(thread, option), { text: `Told the Mayor in ${threadName}: ${option}`, open: openThread });
  }

  async function sendReply() {
    const text = reply.trim();
    if (!text) return;
    const sent =
      need.kind === 'question'
        ? await run(() => sendAnswer(need.bead, text), { text: `Answered ${need.bead}`, open: openThread })
        : await run(() => sendToThread(thread, text), { text: `Sent to the Mayor in ${threadName}`, open: openThread });
    if (sent) {
      setReply('');
      setReplying(false);
    }
  }

  const long = need.text.length > 280;
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
        {epicTitle && <span className="min-w-0 truncate text-[12px] text-muted">{epicTitle}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-2 text-[12px] text-faint">
          {need.blocks > 0 && (
            <span title={`${need.blocks} beads wait on this`} className="inline-flex items-center gap-1">
              <Icon name="layers" size={13} />
              {need.blocks}
            </span>
          )}
          <TimeAgo at={need.since} />
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {need.bead ? (
          <a href={beadHref(need.bead)} className="text-[16px] leading-snug font-semibold hover:underline">
            {need.title || need.bead}
          </a>
        ) : (
          <p className="text-[16px] leading-snug font-semibold">{need.title}</p>
        )}
        {need.bead && <span className="font-mono text-[11.5px] text-faint">{need.bead}</span>}
      </div>

      {need.text && need.text !== need.title && !compact && (
        <div className={cx('relative text-muted', !expanded && long && 'max-h-40 overflow-hidden')}>
          <Markdown text={need.text} />
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

      {hasSteps && <HandsSteps bead={need.bead} steps={need.steps} />}

      {options.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Answers">
          {options.map((option) => {
            const recommended = option === need.recommended && options.length > 1;
            return (
              <Button
                key={option}
                variant={recommended || options.length === 1 ? 'primary' : 'secondary'}
                onClick={() => void choose(option)}
                disabled={busy}
                className="max-w-full"
                aria-label={recommended ? `${option} (recommended)` : option}
              >
                <span className="truncate">{option}</span>
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
            <Button variant="primary" size="sm" icon="send" busy={busy} disabled={!reply.trim()} onClick={() => void sendReply()}>
              Send
            </Button>
          </div>
        </div>
      )}

      <div className="-mb-1 flex items-center gap-1 border-t border-line pt-2">
        {!replying && (
          <Button variant="ghost" size="sm" icon="talk" onClick={() => setReplying(true)}>
            {need.kind === 'question' ? 'Answer in words' : 'Reply'}
          </Button>
        )}
        {need.bead && (
          <a href={beadHref(need.bead)} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm text-muted hover:bg-raised hover:text-fg">
            <Icon name="forward" size={16} />
            Open
          </a>
        )}
        <IconButton icon="speaker" label="Read aloud" size="sm" className="ml-auto" onClick={() => speak(spokenText(need))} />
      </div>
    </article>
  );
}
