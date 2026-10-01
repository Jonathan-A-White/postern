// tests/unit/attachment-retry.test.tsx — mw-t64a3.16: an image attachment whose
// download failed (a timeout under load) says so in plain words with a Retry
// control, retries once by itself when the live stream reconnects or the app
// returns to the foreground, and shows the image once a retry succeeds.
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Conversation } from '../../src/cockpit/Conversation';
import { lock, setKey } from '../../src/services/keySession';
import { noteReconnect } from '../../src/services/live';
import { ApiTimeoutError } from '../../src/services/apiAuth';
import type { ConversationItem } from '../../src/model/conversation';

const openAttachment = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/blobs', () => ({ openAttachment }));

const item: ConversationItem = {
  id: 'm1',
  at: 1_760_000_000_000,
  speaker: 'mayor',
  speakerLabel: 'Mayor',
  kind: 'attachment',
  text: '',
  attachments: [{ hash: 'ab'.repeat(32), size: 2048, mime: 'image/png' }],
  source: 'message',
};

function goForeground(): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('an attachment that failed to load can be loaded again', () => {
  beforeEach(() => {
    openAttachment.mockReset();
    setKey(new Uint8Array(32).fill(7));
  });
  afterEach(() => {
    cleanup();
    lock();
  });
  afterAll(() => cleanup());

  it('AC-1: a timed-out image says "Could not load this file" with Retry, and Retry shows the image', async () => {
    openAttachment.mockRejectedValueOnce(new ApiTimeoutError(false)).mockResolvedValueOnce('blob:image-1');
    render(<Conversation items={[item]} />);
    expect(await screen.findByText(/Could not load this file/)).toBeInTheDocument();
    expect(screen.getByText(/did not answer in time/)).toBeInTheDocument();
    expect(screen.queryByText(/aborted/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    const img = await screen.findByAltText('Attached image');
    expect(img).toHaveAttribute('src', 'blob:image-1');
    expect(screen.queryByText(/Could not load this file/)).toBeNull();
    expect(openAttachment).toHaveBeenCalledTimes(2);
  });

  it('AC-2: after a failed load a stream reconnect retries once and the image shows', async () => {
    openAttachment.mockRejectedValueOnce(new ApiTimeoutError(false)).mockResolvedValueOnce('blob:image-2');
    render(<Conversation items={[item]} />);
    await screen.findByText(/Could not load this file/);
    act(() => noteReconnect());
    expect((await screen.findByAltText('Attached image')).getAttribute('src')).toBe('blob:image-2');
    expect(openAttachment).toHaveBeenCalledTimes(2);
  });

  it('AC-2: returning to the foreground retries once, and a second failure waits for a tap', async () => {
    openAttachment
      .mockRejectedValueOnce(new ApiTimeoutError(false))
      .mockRejectedValueOnce(new ApiTimeoutError(false))
      .mockResolvedValueOnce('blob:image-3');
    render(<Conversation items={[item]} />);
    await screen.findByText(/Could not load this file/);
    act(() => goForeground());
    await waitFor(() => expect(openAttachment).toHaveBeenCalledTimes(2));
    await screen.findByText(/Could not load this file/);
    act(() => {
      goForeground();
      noteReconnect();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(openAttachment).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect((await screen.findByAltText('Attached image')).getAttribute('src')).toBe('blob:image-3');
  });

  it('a reconnect or foreground event does nothing to an attachment that loaded', async () => {
    openAttachment.mockResolvedValue('blob:image-4');
    render(<Conversation items={[item]} />);
    await screen.findByAltText('Attached image');
    act(() => {
      goForeground();
      noteReconnect();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(openAttachment).toHaveBeenCalledTimes(1);
  });
});
