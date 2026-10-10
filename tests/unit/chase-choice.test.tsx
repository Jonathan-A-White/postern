// tests/unit/chase-choice.test.tsx — mw-xpy2ds: the chase need's Chase, Done and Keep waiting are one choice that
// sends once (however fast it is tapped), and once any of the three is on its way the card is dead and says so.
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NeedCard } from '../../src/cockpit/NeedCard';
import { db } from '../../src/data/db';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { forgetOutboxState, settledOutbox } from '../../src/services/outbox';
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

const delivered = { txid: 'direct:' + '3'.repeat(64), channel: 'direct' as const };

function chaseNeed(bead: string): Need {
  return {
    kind: 'chase',
    bead,
    epic: '',
    title: 'Write the permissions memo',
    since: new Date(Date.now() - 60_000).toISOString(),
    text: 'Chase sam on Write the permissions memo',
    recommended: '',
    options: [],
    blocks: 0,
    steps: [],
    waits_for: 'you',
  };
}

describe('the chase need is dead once one of its three answers is on its way', () => {
  beforeEach(async () => {
    vi.mocked(deliverAction).mockReset();
    vi.mocked(deliverAction).mockResolvedValue(delivered);
    forgetTaps();
    forgetOutboxState();
    await Promise.all([db.view.clear(), db.answers.clear(), db.messages.clear(), db.outbox.clear()]);
  });
  afterEach(() => {
    cleanup();
    forgetOutboxState();
  });
  afterAll(() => cleanup());

  it('offers the three buttons, labelled for what a tap does, and says what each means', () => {
    render(<NeedCard need={chaseNeed('mw-chase.1')} />);
    const group = screen.getByRole('group', { name: 'Answers' });
    expect(within(group).getAllByRole('button').map((button) => button.textContent)).toEqual(['Chase', 'Done', 'Keep waiting']);
    expect(screen.getByText(/Chase: you are nudging them now\. Done: they delivered\. Keep waiting: ask again in three working days\./)).toBeInTheDocument();
  });

  it('sends once for a double tap, and a different answer cannot follow it', async () => {
    render(<NeedCard need={chaseNeed('mw-chase.2')} />);
    const done = screen.getByRole('button', { name: 'Done' });
    fireEvent.click(done);
    fireEvent.click(done);
    await waitFor(() => expect(deliverAction).toHaveBeenCalledTimes(1));
    await act(async () => settledOutbox());
    expect(within(screen.getByTestId('need-card')).getByRole('status')).toHaveTextContent(/Tapped|waiting for the factory/i);
    for (const name of ['Chase', 'Done', 'Keep waiting']) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(deliverAction).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deliverAction).mock.calls[0][0]).toEqual({ action: 'ask_done', bead: 'mw-chase.2' });
  });

  it('stays dead, marked pending, when the send is refused', async () => {
    vi.mocked(deliverAction).mockRejectedValueOnce(new Error('The backend refused the message.'));
    render(<NeedCard need={chaseNeed('mw-chase.3')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Keep waiting' }));
    await waitFor(() => expect(deliverAction).toHaveBeenCalledTimes(1));
    await act(async () => settledOutbox());
    await waitFor(() => expect(within(screen.getByTestId('need-card')).getByTestId('pending-mark')).toBeInTheDocument());
    for (const name of ['Chase', 'Done', 'Keep waiting']) expect(screen.queryByRole('button', { name })).toBeNull();
  });
});
