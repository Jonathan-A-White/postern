// tests/unit/verified-button.test.tsx — mw-581qad.1: one VerifiedButton: tap, confirm, then a channel
// message that begins VERIFIED; it settles the card at once, like an action did.
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NeedCard } from '../../src/cockpit/NeedCard';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { forgetOutboxState, settledOutbox } from '../../src/services/outbox';
import { deliverThreaded, deliverAction } from '../../src/services/deliver';
import { unsettledNeeds } from '../../src/model/needs';
import { fixtureView } from '../support/cockpit-fixture';
import type { Need } from '../../src/model/view';

vi.mock('../../src/services/deliver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/deliver')>()),
  deliverThreaded: vi.fn(),
  deliverAction: vi.fn(),
}));
vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  deliverOptions: () => ({ key: new Uint8Array(32), mayorKey: '02' + '11'.repeat(32), direct: true }),
}));

const BEAD = 'mw-v';
const WORDS = 'VERIFIED (tapped Verified in Needs you)';
const delivered = { txid: 'direct:' + '2'.repeat(64), channel: 'direct' as const };

function verifyNeed(over: Partial<Need> = {}): Need {
  return { kind: 'verify', bead: BEAD, epic: '', title: 'Paint the door', since: new Date(Date.now() - 60_000).toISOString(), text: '1. Look at the door', recommended: '', options: ['Verified'], blocks: 0, steps: [], ...over };
}

const waitingOnMayor = (): Need => verifyNeed({ text: '', waits_for: 'mayor', not_ready: true, waiting_on: ['the Mayor to check the landing'] });

describe('the Verified button', () => {
  beforeEach(async () => {
    vi.mocked(deliverThreaded).mockReset();
    vi.mocked(deliverAction).mockReset();
    vi.mocked(deliverThreaded).mockResolvedValue(delivered);
    forgetTaps();
    forgetOutboxState();
    await Promise.all([db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear(), db.outbox.clear()]);
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    forgetOutboxState();
  });
  afterAll(() => cleanup());

  it('is offered on a card that waits on him and on one that waits on the Mayor', () => {
    render(<NeedCard need={verifyNeed({ waits_for: 'you' })} />);
    expect(screen.getByRole('button', { name: 'Verified' })).toBeEnabled();
    cleanup();
    render(<NeedCard need={waitingOnMayor()} />);
    expect(screen.getByRole('button', { name: 'Verified' })).toBeEnabled();
    expect(screen.getByText('Waits on the Mayor')).toBeInTheDocument();
    expect(screen.getByText('the Mayor to check the landing')).toBeInTheDocument();
  });

  it('asks first, and sends nothing until he says yes', async () => {
    render(<NeedCard need={verifyNeed()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verified' }));
    expect(screen.getByText('Mark mw-v verified? The Mayor is told you checked it and it works.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes, verified' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Not yet' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Verified' })).toBeNull();
    await act(async () => settledOutbox());
    expect(await db.outbox.count()).toBe(0);
    expect(deliverThreaded).not.toHaveBeenCalled();
  });

  it('folds back on Not yet', () => {
    render(<NeedCard need={verifyNeed()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verified' }));
    fireEvent.click(screen.getByRole('button', { name: 'Not yet' }));
    expect(screen.getByRole('button', { name: 'Verified' })).toBeInTheDocument();
    expect(screen.queryByText(/Mark mw-v verified\?/)).toBeNull();
  });

  it('folds back after 8 seconds untouched', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(<NeedCard need={verifyNeed()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verified' }));
    act(() => void vi.advanceTimersByTime(7_900));
    expect(screen.getByRole('button', { name: 'Yes, verified' })).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.queryByRole('button', { name: 'Yes, verified' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Verified' })).toBeInTheDocument();
  });

  it('queues exactly one VERIFIED message to the bead channel, even for a double tap, and the card goes dead', async () => {
    render(<NeedCard need={verifyNeed()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verified' }));
    const yes = screen.getByRole('button', { name: 'Yes, verified' });
    fireEvent.click(yes);
    fireEvent.click(yes);
    await waitFor(async () => expect(await db.outbox.count()).toBe(1));
    await act(async () => settledOutbox());
    const [row] = await db.outbox.toArray();
    expect(row).toMatchObject({ kind: 'message', bead: BEAD, thread: 'bead:mw-v', payload: { text: WORDS, settles: 'verified' } });
    expect(deliverThreaded).toHaveBeenCalledTimes(1);
    expect(deliverThreaded).toHaveBeenCalledWith(expect.objectContaining({ text: WORDS, thread: { bead: BEAD } }), expect.anything());
    expect(deliverAction).not.toHaveBeenCalled();
    await waitFor(() => expect(within(screen.getByTestId('need-card')).getByRole('status')).toHaveTextContent('Sent, waiting for the factory'));
    expect(screen.queryByRole('button', { name: 'Verified' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Yes, verified' })).toBeNull();
  });

  it('remembers a delivered message as an answer, so the card leaves the queue', async () => {
    render(<NeedCard need={verifyNeed()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verified' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, verified' }));
    await waitFor(async () => expect(await db.outbox.count()).toBe(1));
    await act(async () => settledOutbox());
    await waitFor(async () => expect(await db.answers.get(BEAD)).toMatchObject({ bead: BEAD, answer: 'verified', txid: delivered.txid }));
    const answers = await db.answers.toArray();
    expect(unsettledNeeds([verifyNeed()], answers)).toEqual([]);
  });

  it('keeps the card dead while the message is still queued, across a reload', async () => {
    vi.mocked(deliverThreaded).mockRejectedValue(new Error('offline'));
    render(<NeedCard need={verifyNeed()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verified' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, verified' }));
    await waitFor(async () => expect(await db.outbox.count()).toBe(1));
    await act(async () => settledOutbox());
    cleanup();
    forgetTaps();
    forgetOutboxState();
    render(<NeedCard need={verifyNeed()} />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Verified' })).toBeNull());
    expect(within(screen.getByTestId('need-card')).getByRole('status')).toHaveTextContent('Tapped');
  });

  it("shares one state between the card and the bead page's Actions row", async () => {
    const writtenAt = Date.now() - 60_000;
    const view = fixtureView(writtenAt);
    view.written_at = new Date(writtenAt).toISOString();
    await viewRepo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, source: 'live', fetchedAt: writtenAt });
    render(<BeadScreen id="mw-gq6.130" />);
    const buttons = await screen.findAllByRole('button', { name: 'Verified' });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, verified' }));
    await waitFor(async () => expect(await db.outbox.count()).toBe(1));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Verified' })).toBeNull());
    expect(screen.queryByRole('button', { name: 'Yes, verified' })).toBeNull();
    expect(screen.getAllByText(/waiting for the factory|Tapped/).length).toBeGreaterThan(0);
    const [row] = await db.outbox.toArray();
    expect(row.payload).toMatchObject({ text: expect.stringMatching(/^VERIFIED \(tapped Verified /), settles: 'verified' });
  });
});
