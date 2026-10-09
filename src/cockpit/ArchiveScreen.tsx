// src/cockpit/ArchiveScreen.tsx — 'Archived cards' (mw-v1uyku.1): the live cards that went 48 h
// untouched and left Needs you, newest touch first. Each is a closed row that opens to the card as it
// now reads; every one keeps listening for its events, open or not, and an event that ticks an item,
// an update, a tap on a link or a message naming its bead brings it back to Needs you. Nothing is deleted.
import { useState } from 'react';
import { EmptyState, Icon, TimeAgo, cx } from '../ui';
import { Screen } from './Shell';
import { LiveCard } from './LiveCard';
import { useCardArchive, useViewIndex } from './hooks';
import { useCardTicking } from './useCardTicking';
import { formatRoute } from '../nav/route';
import type { LiveCard as LiveCardData } from '../model/cards';

function Ticker({ card }: { card: LiveCardData }) {
  useCardTicking(card);
  return null;
}

/** Listens for the events of every archived card, whether or not one is open to see. */
export function CardTickers({ cards }: { cards: LiveCardData[] }) {
  return (
    <>
      {cards.map((card) => (
        <Ticker key={card.id} card={card} />
      ))}
    </>
  );
}

/** The way in to the archive, shown on Needs you and on Me while any card is archived. */
export function ArchivedCardsLink({ className }: { className?: string }) {
  const { archived } = useCardArchive();
  if (archived.length === 0) return null;
  return (
    <>
      <CardTickers cards={archived} />
      <a
        href={formatRoute({ view: 'archive' })}
        className={cx('flex h-11 w-full items-center gap-2.5 rounded-2xl border border-line bg-surface px-4 text-[14.5px] font-semibold text-muted hover:bg-raised', className)}
      >
        <Icon name="archive" size={18} />
        Archived cards · {archived.length}
        <Icon name="forward" size={14} className="ml-auto" />
      </a>
    </>
  );
}

function ArchivedEntry({ card, titleOf }: { card: LiveCardData; titleOf: (bead: string) => string | undefined }) {
  const [open, setOpen] = useState(false);
  const done = card.items.filter((item) => item.done).length;
  return (
    <li className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="flex min-h-12 w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-2 text-left hover:border-line-strong"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-semibold">{card.title}</span>
          <span className="block text-[12px] text-faint">
            {done} of {card.items.length} done · last touched <TimeAgo at={card.touchedAt} />
          </span>
        </span>
        <Icon name={open ? 'down' : 'forward'} size={14} className="shrink-0 text-faint" />
      </button>
      {open && <LiveCard card={card} titleOf={titleOf} ticking={false} />}
    </li>
  );
}

export function ArchiveScreen() {
  const { archived } = useCardArchive();
  const view = useViewIndex();
  const titleOf = (bead: string) => view?.index.byId.get(bead)?.title;
  return (
    <Screen title="Archived cards" back={{ view: 'needs' }}>
      <CardTickers cards={archived} />
      {archived.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line">
          <EmptyState icon="archive" title="Nothing is archived">
            A card that nobody has touched for 48 hours waits here. An item ticking, an update, a tap on one of its links or a message about its bead brings it back to Needs you.
          </EmptyState>
        </div>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Archived cards">
          {archived.map((card) => (
            <ArchivedEntry key={card.id} card={card} titleOf={titleOf} />
          ))}
        </ul>
      )}
    </Screen>
  );
}
