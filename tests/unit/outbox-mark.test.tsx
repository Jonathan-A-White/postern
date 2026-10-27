// tests/unit/outbox-mark.test.tsx — mw-jrx0s.21: a refused row says what the backend said and offers Retry and
// Discard wherever it is shown (a one-tap button, a Talk turn, a Call me); a waiting row wears the pending mark.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db } from '../../src/data/db';
import { outboxRepo } from '../../src/data/repositories';
import { OutboxMark } from '../../src/cockpit/OutboxMark';
import { WaitingNote } from '../../src/cockpit/WaitingNote';
import { forgetOutboxState, settledOutbox } from '../../src/services/outbox';

afterEach(async () => {
  cleanup();
  forgetOutboxState();
  await db.outbox.clear();
});

describe('OutboxMark', () => {
  it('wears the pending mark while a row waits to go', () => {
    render(<OutboxMark row={{ id: 1, state: 'pending' }} />);
    expect(screen.getByTestId('pending-mark')).toBeInTheDocument();
    expect(screen.queryByTestId('failed-note')).toBeNull();
  });

  it('says what the backend said, with Retry and Discard, once a row is refused', () => {
    render(<OutboxMark row={{ id: 1, state: 'failed', failure: 'unknown class' }} />);
    expect(screen.getByTestId('failed-note')).toHaveTextContent('Not sent: unknown class');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
  });

  it('Retry puts the row back to pending and Discard forgets it', async () => {
    const id = await db.outbox.add({ kind: 'action', bead: 'mw-a', payload: {}, created: 1, attempts: 1, state: 'failed', failure: 'no' });
    const other = await db.outbox.add({ kind: 'action', bead: 'mw-b', payload: {}, created: 2, attempts: 1, state: 'failed', failure: 'no' });
    render(<OutboxMark row={{ id: other, state: 'failed', failure: 'no' }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(async () => expect((await outboxRepo.all()).map((row) => row.id)).toEqual([id]));
    await outboxRepo.requeue(id);
    await settledOutbox();
    expect(await db.outbox.get(id)).toMatchObject({ state: 'pending', attempts: 0 });
  });
});

describe('a tap on the pending mark (mw-o14xubc)', () => {
  it('says why the row waits, with Retry now and Discard', async () => {
    render(<OutboxMark row={{ id: 1, state: 'pending', note: 'The connection was cut before the backend answered.' }} />);
    expect(screen.queryByTestId('pending-why')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Pending: tap for why' }));
    expect(screen.getByTestId('pending-why')).toHaveTextContent('The connection was cut before the backend answered.');
    expect(screen.getByRole('button', { name: 'Retry now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
    // A second tap folds it away.
    await userEvent.click(screen.getByRole('button', { name: 'Pending: tap for why' }));
    expect(screen.queryByTestId('pending-why')).toBeNull();
  });

  it('says a row no try has failed yet is waiting to send', async () => {
    render(<OutboxMark row={{ id: 1, state: 'pending' }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Pending: tap for why' }));
    expect(screen.getByTestId('pending-why')).toHaveTextContent('Waiting to send.');
  });

  it('Retry now puts the row back as untried, its error forgotten, and Discard forgets the row', async () => {
    const id = await db.outbox.add({ kind: 'message', bead: '', payload: { text: 'hi', files: [] }, created: 1, attempts: 7, nextAt: Date.now() + 60_000, state: 'pending', note: 'cut', error: { message: 'Failed to fetch', at: 1, attempt: 7 }, reportedAt: 1 });
    const other = await db.outbox.add({ kind: 'message', bead: '', payload: { text: 'there', files: [] }, created: 2, attempts: 2, state: 'pending', note: 'cut' });
    render(
      <>
        <OutboxMark row={{ id, state: 'pending', note: 'cut' }} />
        <OutboxMark row={{ id: other, state: 'pending', note: 'cut' }} />
      </>,
    );
    const [first, second] = screen.getAllByRole('button', { name: 'Pending: tap for why' });
    await userEvent.click(first);
    await userEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    await waitFor(async () => expect(await db.outbox.get(id)).toMatchObject({ state: 'pending', attempts: 0 }));
    const retried = await db.outbox.get(id);
    expect(retried?.error).toBeUndefined();
    expect(retried?.note).toBeUndefined();
    expect(retried?.nextAt).toBeUndefined();
    await settledOutbox();
    // The first row's why folds away; the second's opens.
    await userEvent.click(first);
    await userEvent.click(second);
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(async () => expect((await outboxRepo.all()).map((row) => row.id)).toEqual([id]));
  });
});

describe('WaitingNote', () => {
  it('shows a refused tap as not sent, not as waiting for the factory', () => {
    render(<WaitingNote pending queued={{ id: 3, kind: 'action', bead: 'mw-a', payload: {}, created: 1, attempts: 1, state: 'failed', failure: 'unknown class' }} />);
    expect(screen.getByTestId('failed-note')).toHaveTextContent('Not sent: unknown class');
    expect(screen.queryByText('Sent, waiting for the factory')).toBeNull();
  });
});
