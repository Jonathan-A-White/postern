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

describe('WaitingNote', () => {
  it('shows a refused tap as not sent, not as waiting for the factory', () => {
    render(<WaitingNote pending queued={{ id: 3, kind: 'action', bead: 'mw-a', payload: {}, created: 1, attempts: 1, state: 'failed', failure: 'unknown class' }} />);
    expect(screen.getByTestId('failed-note')).toHaveTextContent('Not sent: unknown class');
    expect(screen.queryByText('Sent, waiting for the factory')).toBeNull();
  });
});
