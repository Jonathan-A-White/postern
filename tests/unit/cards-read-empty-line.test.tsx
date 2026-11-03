// mw-gq6.909: ArchiveScreen's 'Nothing is archived' and Needs you's 'Nothing needs you' are drawn from the
// cards (and the messages that touch them) the phone holds; neither says "nothing" before those two local reads
// have answered. Until then each says it is reading; once they have, an empty phone shows the empty line as before.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { ArchiveScreen } from '../../src/cockpit/ArchiveScreen';
import { NeedsScreen } from '../../src/cockpit/NeedsScreen';
import { forgetLastKnown } from '../../src/cockpit/lastKnown';
import { db, type CardRow, type MessageRow } from '../../src/data/db';
import { cardsRepo, messagesRepo, viewRepo } from '../../src/data/repositories';
import type { View } from '../../src/model/view';
import { fixtureView } from '../support/cockpit-fixture';

const AT = Date.parse('2026-10-01T12:30:00Z');

async function storeView(): Promise<void> {
  const written = new Date(AT).toISOString();
  const view: View = { ...fixtureView(AT), written_at: written, needs: [], beads: [] };
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: written, etag: '"first"', source: 'live', fetchedAt: AT });
}

/** A local read that has not answered yet; `answer` lets it. */
function heldRead<T>(): { promise: Promise<T>; answer: (value: T) => void } {
  let answer!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    answer = resolve;
  });
  return { promise, answer };
}

beforeEach(async () => {
  forgetLastKnown();
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.messages.clear(), db.cards.clear()]);
  window.history.replaceState(null, '', '/?v=needs');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Archived cards before the phone has read its cards', () => {
  it('does not say "Nothing is archived" while the cards read is held back', async () => {
    const cards = heldRead<CardRow[]>();
    vi.spyOn(cardsRepo, 'getAll').mockReturnValue(cards.promise);
    render(<ArchiveScreen />);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
    expect(screen.queryByText('Nothing is archived')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Reading');
    await act(async () => cards.answer([]));
    expect(await screen.findByText('Nothing is archived')).toBeInTheDocument();
  });

  it('does not say "Nothing is archived" while the messages read is held back', async () => {
    const messages = heldRead<MessageRow[]>();
    vi.spyOn(messagesRepo, 'getAllOldestFirst').mockReturnValue(messages.promise);
    render(<ArchiveScreen />);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
    expect(screen.queryByText('Nothing is archived')).not.toBeInTheDocument();
    await act(async () => messages.answer([]));
    expect(await screen.findByText('Nothing is archived')).toBeInTheDocument();
  });

  it('shows "Nothing is archived" once both reads have answered and nothing is held', async () => {
    render(<ArchiveScreen />);
    expect(await screen.findByText('Nothing is archived')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('Needs you before the phone has read its cards', () => {
  it('does not say "Nothing needs you" while the cards read is held back', async () => {
    await storeView();
    const cards = heldRead<CardRow[]>();
    vi.spyOn(cardsRepo, 'getAll').mockReturnValue(cards.promise);
    render(<NeedsScreen />);
    await screen.findByRole('tab', { name: /^You · \d+$/ });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
    expect(screen.queryByText('Nothing needs you')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Reading');
    await act(async () => cards.answer([]));
    expect(await screen.findByText('Nothing needs you')).toBeInTheDocument();
  });

  it('does not say "Nothing needs you" while the messages read is held back', async () => {
    await storeView();
    const messages = heldRead<MessageRow[]>();
    vi.spyOn(messagesRepo, 'getAllOldestFirst').mockReturnValue(messages.promise);
    render(<NeedsScreen />);
    await screen.findByRole('tab', { name: /^You · \d+$/ });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
    expect(screen.queryByText('Nothing needs you')).not.toBeInTheDocument();
    await act(async () => messages.answer([]));
    expect(await screen.findByText('Nothing needs you')).toBeInTheDocument();
  });

  it('shows "Nothing needs you" once both reads have answered and nothing is held', async () => {
    await storeView();
    render(<NeedsScreen />);
    expect(await screen.findByText('Nothing needs you')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('does not make the Mayor and Factory lines wait for the cards', async () => {
    await storeView();
    vi.spyOn(cardsRepo, 'getAll').mockReturnValue(heldRead<CardRow[]>().promise);
    render(<NeedsScreen who="mayor" />);
    expect(await screen.findByText('Nothing waits on the Mayor')).toBeInTheDocument();
  });
});
