// src/cockpit/useCardTicking.ts — a card listens (useEvents) to the beads and kinds it names and
// ticks an item off itself, with the event's time, when the state that item expects arrives
// (mw-nqur1n.11). A card in the archive listens the same way (mw-v1uyku.1): a tick is a touch.
import { useEffect } from 'react';
import { tickFromEvents } from '../services/cards';
import { useEvents } from '../services/events';
import type { LiveCard } from '../model/cards';

export function useCardTicking(card: LiveCard): void {
  const heard = useEvents({ kinds: card.subscribe.kinds, beads: card.subscribe.beads });
  // The items still waiting on an event, as a key, so the effect runs when the set changes and not on every render.
  const waiting = card.items.filter((item) => !item.done && item.expect).map((item) => `${item.n}:${item.since}`).join(',');
  const beads = card.subscribe.beads.join(',');
  useEffect(() => {
    if (waiting !== '') void tickFromEvents(card);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heard, waiting, beads]);
}
