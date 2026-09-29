// tests/unit/one-tap-action.test.tsx — mw-t64a3.3: a one-tap action (Release,
// Hold, Verified) sends once however fast it is tapped, says at once that it is
// waiting for the factory on every surface that offers it, and comes back only
// when the send failed or a newer view still asks for it.
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { NeedCard } from '../../src/cockpit/NeedCard';
import { ToastHost } from '../../src/ui/toast';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { fixtureView } from '../support/cockpit-fixture';
import { deliverAction } from '../../src/services/deliver';
import type { Need } from '../../src/model/view';

vi.mock('../../src/services/deliver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/deliver')>()),
  deliverAction: vi.fn(),
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
    forgetTaps();
    await Promise.all([db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear()]);
  });
  afterEach(() => cleanup());
  afterAll(() => cleanup());

  it('sends once for a double tap in the same tick, and the card says it is waiting', async () => {
    const send = slowSend();
    render(<NeedCard need={approveNeed('mw-tap.1')} />);
    const release = screen.getByRole('button', { name: 'Release' });
    fireEvent.click(release);
    fireEvent.click(release);
    expect(deliverAction).toHaveBeenCalledTimes(1);
    expect(within(screen.getByTestId('need-card')).getByRole('status')).toHaveTextContent(/waiting for the factory/i);
    expect(screen.queryByRole('button', { name: 'Release' })).toBeNull();
    await act(async () => send.finish());
    expect(deliverAction).toHaveBeenCalledTimes(1);
  });

  it('shows the failure and gives the button back when the send fails', async () => {
    const send = slowSend();
    render(
      <>
        <NeedCard need={approveNeed('mw-tap.2')} />
        <ToastHost />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Release' }));
    expect(within(screen.getByTestId('need-card')).getByRole('status')).toHaveTextContent(/waiting for the factory/i);
    await act(async () => send.fail('The backend refused the message.'));
    expect(await screen.findByText('The backend refused the message.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Release' })).toBeEnabled());
    expect(within(screen.getByTestId('need-card')).queryByText(/waiting for the factory/i)).toBeNull();
  });

  it('tapping Verified on the bead page settles the card and the action button together', async () => {
    await storeView(Date.now() - 60_000);
    const send = slowSend();
    render(<BeadScreen id={VERIFY} />);
    const buttons = await screen.findAllByRole('button', { name: 'Verified' });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    fireEvent.click(buttons[0]);
    expect(deliverAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Verified' })).toBeNull();
    expect(screen.getAllByText(/waiting for the factory/i).length).toBeGreaterThan(0);
    await act(async () => send.finish());
    // Delivered, the view has not republished: still waiting, still no second tap.
    await waitFor(async () => expect(await db.answers.get(VERIFY)).toBeDefined());
    await act(async () => {});
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Verified' })).toBeNull());
    expect(screen.getAllByText(/waiting for the factory/i).length).toBeGreaterThan(0);
    expect(deliverAction).toHaveBeenCalledTimes(1);
  });

  it('clears once the next view drops the need, and offers it again if the view still asks', async () => {
    await storeView(Date.now() - 60_000);
    const send = slowSend();
    render(<BeadScreen id={VERIFY} />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Verified' }))[0]);
    await act(async () => send.finish());
    await waitFor(() => expect(screen.getAllByText(/waiting for the factory/i).length).toBeGreaterThan(0));

    await act(async () => {
      await storeView(Date.now() + 5_000);
    });
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Verified' })).toHaveLength(2));
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
