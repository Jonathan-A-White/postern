// src/cockpit/LiveCard.tsx — a live card (docs/protocol.md §24, mw-nqur1n.11): the Mayor's
// numbered list, each item with the beads it links to, where he can go to do it. The card
// listens (useEvents) to the beads and kinds it names and ticks an item off itself, with the
// event's time, when the state that item expects arrives; a card-update changes this same card.
import { useEffect, useMemo } from 'react';
import { Markdown } from '../markdown';
import { cardShareText, shareTitle as titleOfShare } from '../model/shareText';
import { ShareButton } from './ShareButton';
import { Chip, Icon, cx } from '../ui';
import { clockTime } from '../services/age';
import { beadHref } from '../nav/route';
import { tickFromEvents } from '../services/cards';
import { useEvents } from '../services/events';
import { useCards, useViewIndex } from './hooks';
import type { LiveCard as LiveCardData } from '../model/cards';

export interface LiveCardProps {
  card: LiveCardData;
  /** A bead's title when the view knows it; the link reads the id without it. */
  titleOf?: (bead: string) => string | undefined;
  /** The title Share gives the phone's share sheet (shareTitle() of its channel). */
  shareTitle?: string;
}

export function LiveCard({ card, titleOf, shareTitle = titleOfShare() }: LiveCardProps) {
  const heard = useEvents({ kinds: card.subscribe.kinds, beads: card.subscribe.beads });
  // The items still waiting on an event, as a key, so the effect runs when the set changes and not on every render.
  const waiting = card.items.filter((item) => !item.done && item.expect).map((item) => `${item.n}:${item.since}`).join(',');
  const beads = card.subscribe.beads.join(',');
  useEffect(() => {
    if (waiting !== '') void tickFromEvents(card);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heard, waiting, beads]);

  const done = card.items.filter((item) => item.done).length;
  return (
    <article className="flex min-w-0 flex-col gap-3 overflow-hidden rounded-2xl border border-line bg-surface p-4" data-testid="live-card" aria-label={`Card: ${card.title}`}>
      <div className="flex items-center gap-2">
        <Chip tone={card.done ? 'done' : 'needs'} icon={card.done ? 'check' : 'list'}>
          Card
        </Chip>
        <span className="ml-auto shrink-0 text-[12px] text-faint">
          {done} of {card.items.length} done
        </span>
        <ShareButton title={shareTitle} text={cardShareText(card)} className="shrink-0 text-[12px]" />
      </div>
      <h3 className="min-w-0 text-[15.5px] leading-snug font-semibold break-words">{card.title}</h3>
      <ol className="flex flex-col gap-3">
        {card.items.map((item) => (
          <li key={item.n} className="flex gap-3" data-testid="live-card-item" data-done={item.done ? 'true' : 'false'}>
            <span
              className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold', item.done ? 'bg-done/20 text-done' : 'bg-raised text-muted')}
              aria-hidden="true"
            >
              {item.done ? <Icon name="check" size={14} /> : item.n}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className={cx('text-[14.5px] leading-snug break-words', item.done && 'text-muted')} data-testid="live-card-item-text">
                <span className="sr-only">{item.n}. </span>
                <Markdown text={item.text} inline />
              </div>
              {item.links.length > 0 && (
                <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label={`Links for item ${item.n}`}>
                  {item.links.map((id) => (
                    <li key={id} className="min-w-0">
                      <a href={beadHref(id)} className="inline-flex min-w-0 max-w-full items-center gap-1 text-[13px] font-semibold text-accent underline-offset-2 hover:underline">
                        <Icon name="forward" size={12} className="shrink-0" />
                        <span className="min-w-0 truncate">{titleOf?.(id) ?? id}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {item.done && (
                <p role="status" className="inline-flex items-center gap-1.5 text-[12.5px] text-muted">
                  <Icon name="check" size={13} className="shrink-0" />
                  <span>Done{item.doneAt !== undefined ? ` ${clockTime(new Date(item.doneAt))}` : ''}</span>
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}

/** The cards sent to one thread, above its messages: `threadKey` as threadKey() writes it, undefined for Factory.
 * Done ones stay, ticked, as the record of what was asked. */
export function ThreadCards({ threadKey, shareTitle }: { threadKey: string | undefined; shareTitle?: string }) {
  const cards = useCards();
  const view = useViewIndex();
  const here = useMemo(() => cards.filter((card) => card.thread === threadKey), [cards, threadKey]);
  if (here.length === 0) return null;
  return (
    <div className="mb-3 flex flex-col gap-3" data-testid="thread-cards">
      {here.map((card) => (
        <LiveCard key={card.id} card={card} titleOf={(bead) => view?.index.byId.get(bead)?.title} shareTitle={shareTitle} />
      ))}
    </div>
  );
}
