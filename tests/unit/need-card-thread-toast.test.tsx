// mw-t64a3.1: a reply sent from a Needs card says which thread it went to, and
// the toast's Open action lands on that thread's Talk view.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NeedCard } from '../../src/cockpit/NeedCard';
import { ToastHost } from '../../src/ui/toast';
import { parseRoute } from '../../src/nav/route';
import type { Need } from '../../src/model/view';

const sendToThread = vi.fn();
const sendAnswer = vi.fn();

vi.mock('../../src/cockpit/send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/cockpit/send')>()),
  sendToThread: (...args: unknown[]) => sendToThread(...args),
  sendAnswer: (...args: unknown[]) => sendAnswer(...args),
}));

function need(overrides: Partial<Need>): Need {
  return { kind: 'alarm', bead: '', epic: '', title: 'Doctor: disk almost full', since: new Date().toISOString(), text: '', recommended: '', options: [], blocks: 0, steps: [], ...overrides } as Need;
}

function renderCard(n: Need) {
  render(
    <>
      <NeedCard need={n} />
      <ToastHost />
    </>,
  );
}

// The toast store is module-level and each toast lives 3.5 s, so find one by its words.
async function toastSaying(text: string): Promise<HTMLElement> {
  return (await screen.findByText(text)).closest('[role="status"], [role="alert"]') as HTMLElement;
}

async function replyWith(text: string) {
  await userEvent.click(screen.getByRole('button', { name: /reply|answer in words/i }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Your reply' }), text);
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));
}

describe('a Needs card says which thread its message went to', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/?v=needs');
    sendToThread.mockResolvedValue([{ txid: 'direct:1', channel: 'direct' }]);
    sendAnswer.mockResolvedValue({ txid: 'direct:2', channel: 'direct' });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('names Factory for a card with no bead, and Open routes to the general thread', async () => {
    renderCard(need({}));
    await replyWith('On it');
    const toast = await toastSaying('Sent to the Mayor in Factory');
    await userEvent.click(within(toast).getByRole('button', { name: 'Open' }));
    expect(parseRoute(window.location.search)).toEqual({ view: 'talk', thread: 'general' });
  });

  it('names the bead for a bead card, and Open routes to that bead thread', async () => {
    renderCard(need({ kind: 'approve', bead: 'mw-abc.1', title: 'Cockpit screens' }));
    await replyWith('Hold on');
    const toast = await toastSaying('Sent to the Mayor in mw-abc.1');
    await userEvent.click(within(toast).getByRole('button', { name: 'Open' }));
    expect(parseRoute(window.location.search)).toEqual({ view: 'talk', thread: 'bead:mw-abc.1' });
  });

  it('names the thread on a one-tap answer that is a message, too', async () => {
    renderCard(need({ kind: 'hands', bead: 'mw-abc.2', options: ['Done'], text: '' }));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    const toast = await toastSaying('Told the Mayor in mw-abc.2: Done');
    expect(within(toast).getByRole('button', { name: 'Open' })).toBeInTheDocument();
  });

  it('keeps "Answered" for a question and gains the same Open', async () => {
    renderCard(need({ kind: 'question', bead: 'mw-q.1', title: 'Which?', options: ['A', 'B'], recommended: 'A' }));
    await userEvent.click(screen.getByRole('button', { name: 'A (recommended)' }));
    const toast = await toastSaying('Answered mw-q.1: A');
    await userEvent.click(within(toast).getByRole('button', { name: 'Open' }));
    expect(parseRoute(window.location.search)).toEqual({ view: 'talk', thread: 'bead:mw-q.1' });
  });

  it('gives no Open on a failed send', async () => {
    sendToThread.mockRejectedValue(new Error('nope'));
    renderCard(need({}));
    await replyWith('x');
    const toast = await toastSaying('nope');
    expect(toast).toHaveAttribute('role', 'alert');
    expect(within(toast).queryByRole('button', { name: 'Open' })).toBeNull();
    await act(async () => {});
    await waitFor(() => expect(sendToThread).toHaveBeenCalled());
  });
});
