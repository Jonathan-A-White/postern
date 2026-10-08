// tests/unit/one-tap-action.test.tsx — mw-t64a3.3: a one-tap action (Release,
// Hold, and Verified, which since mw-581qad.1 sends a VERIFIED channel message) sends once however fast it is tapped, says at once that it is
// waiting for the factory on every surface that offers it, and comes back only
// when the send failed or a newer view still asks for it.
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { NeedCard } from '../../src/cockpit/NeedCard';
import { db } from '../../src/data/db';
import { eventsRepo, viewRepo } from '../../src/data/repositories';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { forgetOutboxState, settledOutbox } from '../../src/services/outbox';
import { fixtureView } from '../support/cockpit-fixture';
import { deliverAction, deliverThreaded } from '../../src/services/deliver';
import type { Need } from '../../src/model/view';

vi.mock('../../src/services/deliver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/deliver')>()),
  deliverAction: vi.fn(),
  deliverThreaded: vi.fn(),
}));
vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  deliverOptions: () => ({ key: new Uint8Array(32), mayorKey: '02' + '11'.repeat(32), direct: true }),
}));

const VERIFY = 'mw-gq6.130';
const delivered = { txid: 'direct:' + '1'.repeat(64), channel: 'direct' as const };

async function storeView(writtenAt: number, mutate?: (view: ReturnType<typeof fixtureView>) => void): Promise<void> {
  const view = fixtureView(writtenAt);
  view.written_at = new Date(writtenAt).toISOString();
  mutate?.(view);
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, source: 'live', fetchedAt: writtenAt });
}

function approveNeed(bead: string): Need {
  return { kind: 'approve', bead, epic: '', title: 'Cockpit screens', since: new Date(Date.now() - 60_000).toISOString(), text: '', recommended: 'Release', options: ['Release'], blocks: 0, steps: [] };
}

/** A send that stays in flight until the test lets it finish or fail. */
function slowSend() {
  let finish!: () => void;
  let fail!: (err: Error) => void;
  vi.mocked(deliverAction).mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        finish = () => resolve(delivered);
        fail = reject;
      }),
  );
  return { finish: () => finish(), fail: (message: string) => fail(new Error(message)) };
}

describe('a one-tap action sends once and shows it is waiting', () => {
  beforeEach(async () => {
    vi.mocked(deliverAction).mockReset();
    vi.mocked(deliverThreaded).mockReset();
    vi.mocked(deliverThreaded).mockResolvedValue(delivered);
    forgetTaps();
    forgetOutboxState();
    await Promise.all([db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear(), db.outbox.clear()]);
  });
  afterEach(() => {
    cleanup();
    forgetOutboxState();
  });
  afterAll(() => cleanup());

  it('sends once for a double tap in the same tick, and the card says it is waiting', async () => {
    const send = slowSend();
    render(<NeedCard need={approveNeed('mw-tap.1')} />);
    const release = screen.getByRole('button', { name: 'Release' });
    fireEvent.click(release);
    fireEvent.click(release);
    await waitFor(() => expect(deliverAction).toHaveBeenCalledTimes(1));
    expect(within(screen.getByTestId('need-card')).getByRole('status')).toHaveTextContent(/Tapped|waiting for the factory/i);
    expect(screen.queryByRole('button', { name: 'Release' })).toBeNull();
    await act(async () => send.finish());
    await act(async () => settledOutbox());
    await waitFor(() => expect(within(screen.getByTestId('need-card')).getByRole('status')).toHaveTextContent(/waiting for the factory/i));
    expect(deliverAction).toHaveBeenCalledTimes(1);
    expect(await db.outbox.count()).toBe(1);
  });

  it('keeps the tap, marked pending, and the card dead when the send is refused', async () => {
    const send = slowSend();
    render(<NeedCard need={approveNeed('mw-tap.2')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Release' }));
    await waitFor(() => expect(deliverAction).toHaveBeenCalledTimes(1));
    await act(async () => send.fail('The backend refused the message.'));
    await act(async () => settledOutbox());
    // Nothing is thrown at him and the button does not come back: the tap waits in the outbox for its next try.
    await waitFor(() => expect(within(screen.getByTestId('need-card')).getByTestId('pending-mark')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Release' })).toBeNull();
    expect(await db.outbox.toArray()).toMatchObject([{ kind: 'action', state: 'pending', attempts: 1 }]);
  });

  it('tapping Verified on the bead page settles the card and the action button together', async () => {
    await storeView(Date.now() - 60_000);
    render(<BeadScreen id={VERIFY} />);
    // The card's Verified and the Actions row's: two copies of one button.
    const [first, second] = await screen.findAllByRole('button', { name: 'Verified' });
    fireEvent.click(first);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, verified' }));
    // The other copy is dead at once and says so, whichever one he tapped.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Verified' })).toBeNull());
    expect(second).not.toBeInTheDocument();
    expect(screen.getAllByText(/Tapped|waiting for the factory/i).length).toBeGreaterThan(0);
    // One message, VERIFIED first; no action is sent.
    await waitFor(() => expect(deliverThreaded).toHaveBeenCalledTimes(1));
    await act(async () => settledOutbox());
    expect(deliverThreaded).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringMatching(/^VERIFIED \(tapped Verified /), thread: { bead: VERIFY } }), expect.anything());
    expect(deliverAction).not.toHaveBeenCalled();
    // Delivered, the view has not republished: still waiting, still no second tap.
    await waitFor(async () => expect(await db.answers.get(VERIFY)).toBeDefined());
    await act(async () => {});
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Verified' })).toBeNull());
    expect(screen.getAllByText(/waiting for the factory/i).length).toBeGreaterThan(0);
    expect(deliverThreaded).toHaveBeenCalledTimes(1);
  });

  it('clears once the next view drops the need, and offers it again if the view still asks', async () => {
    await storeView(Date.now() - 60_000);
    render(<BeadScreen id={VERIFY} />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Verified' }))[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, verified' }));
    await waitFor(() => expect(deliverThreaded).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByText(/waiting for the factory/i).length).toBeGreaterThan(0));

    await act(async () => {
      await storeView(Date.now() + 5_000);
    });
    // The bead's page filters its needs as Needs you does (mw-tbx1n.10): the card he already acted on stays gone,
    // so the action button is the one offered again.
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Verified' })).toHaveLength(1));
    expect(screen.queryByText(/waiting for the factory/i)).toBeNull();

    await act(async () => {
      await storeView(Date.now() + 10_000, (view) => {
        view.needs = view.needs.filter((need) => need.bead !== VERIFY);
      });
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Verified' })).toBeNull());
    expect(screen.queryByText(/waiting for the factory/i)).toBeNull();
  });
});

// mw-xhtcup.14: with a view that carries a seq, a tap waits until the view has passed the event that
// echoed the tap's txid; the phone's clock is not compared with the host's written_at at all.
describe('a one-tap action waits by seqs, not by the phone clock', () => {
  const DEFERRED = 'mw-f758y.31.2';
  const HOST = Date.parse('2026-10-01T12:00:00Z');

  /** Stores the view the host wrote at `seq` (its written_at is the host's clock); `held` keeps the story deferred. */
  async function storeSeqView(seq: number, writtenAt: number, held = true): Promise<void> {
    await storeView(writtenAt, (view) => {
      view.seq = seq;
      const story = view.beads.find((b) => b.id === DEFERRED);
      if (story && !held) story.status = 'open';
    });
  }

  async function echo(seq: number): Promise<void> {
    await eventsRepo.addNew([{ seq, ts: new Date(HOST).toISOString(), kind: 'bead_changed', bead: DEFERRED, actor: 'governor', from: 'held', to: 'open', detail: delivered.txid, lane: 'ordinary' }]);
  }

  beforeEach(async () => {
    vi.mocked(deliverAction).mockReset();
    vi.mocked(deliverAction).mockResolvedValue(delivered);
    forgetTaps();
    forgetOutboxState();
    await Promise.all([db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear(), db.outbox.clear(), db.events.clear()]);
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    cleanup();
    forgetOutboxState();
    vi.useRealTimers();
  });
  afterAll(() => cleanup());

  async function tapRelease(): Promise<void> {
    render(<BeadScreen id={DEFERRED} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Release' }));
    await waitFor(() => expect(deliverAction).toHaveBeenCalledTimes(1));
    await act(async () => settledOutbox());
    await waitFor(async () => expect(await db.answers.get(DEFERRED)).toBeDefined());
  }

  it('with a slow phone clock stays waiting on a view that lacks the echo, and is not offered again after it', async () => {
    vi.setSystemTime(HOST - 10 * 60_000); // the phone is ten minutes behind the host
    await storeSeqView(10, HOST);
    await tapRelease();
    expect(await db.answers.get(DEFERRED)).toMatchObject({ answer: 'release', viewSeq: 10 });
    await waitFor(() => expect(screen.getAllByText(/waiting for the factory/i).length).toBeGreaterThan(0));

    // A newer view (seq 11, written after the tap by the host's clock, before it by the phone's) without the echo.
    await act(async () => {
      await storeSeqView(11, HOST + 30_000);
    });
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Release' })).toBeNull();
    expect(screen.getAllByText(/waiting for the factory/i).length).toBeGreaterThan(0);

    // The echo (seq 12) is stored and the view of seq 12 arrives with the story released.
    await act(async () => {
      await echo(12);
      await storeSeqView(12, HOST + 60_000, false);
    });
    await waitFor(() => expect(screen.queryByText(/waiting for the factory/i)).toBeNull());
    expect(screen.queryByRole('button', { name: 'Release' })).toBeNull();
    expect(deliverAction).toHaveBeenCalledTimes(1);
  });

  it('with a fast phone clock a view of the echo seq clears the wait although written_at is older than the tap', async () => {
    vi.setSystemTime(HOST + 10 * 60_000); // the phone is ten minutes ahead of the host
    await storeSeqView(10, HOST);
    await tapRelease();
    await waitFor(() => expect(screen.getAllByText(/waiting for the factory/i).length).toBeGreaterThan(0));

    await act(async () => {
      await echo(12);
      await storeSeqView(12, HOST + 60_000);
    });
    // The view still says deferred and its written_at (host clock) is older than the tap (phone clock): the seq says it has seen the tap.
    await waitFor(() => expect(screen.queryByText(/waiting for the factory/i)).toBeNull());
    expect(screen.getByRole('button', { name: 'Release' })).toBeInTheDocument();
  });
});
