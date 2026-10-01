// features/steps/attachment-retry.steps.tsx — runs features/attachment-retry.feature
// (mw-t64a3.16): the real Conversation and live state; only the blob download
// (openAttachment) is a double.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
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

function timesOutOnce(): void {
  cleanup();
  openAttachment.mockReset();
  openAttachment.mockRejectedValueOnce(new ApiTimeoutError(false)).mockResolvedValue('blob:image');
  setKey(new Uint8Array(32).fill(7));
}

async function shown(): Promise<void> {
  render(<Conversation items={[item]} />);
  await screen.findByText(/Could not load this file/);
}

async function imageShown(): Promise<void> {
  expect((await screen.findByAltText('Attached image')).getAttribute('src')).toBe('blob:image');
}

afterAll(() => {
  cleanup();
  lock();
});

const feature = await loadFeature('features/attachment-retry.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('AC-1: a timed-out image says it could not load and Retry shows it', ({ Given, When, Then }) => {
    Given('an image attachment whose first load times out', timesOutOnce);
    When('the conversation is shown', () => {
      render(<Conversation items={[item]} />);
    });
    Then('it says "Could not load this file" with a Retry control', async () => {
      expect(await screen.findByText(/Could not load this file/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
    When('he taps Retry', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });
    Then('the image is shown', imageShown);
  });

  Scenario('AC-2: a stream reconnect after a failed load retries once and the image shows', ({ Given, And, When, Then }) => {
    Given('an image attachment whose first load times out', timesOutOnce);
    And('the conversation is shown', shown);
    When('the live stream reconnects', () => {
      act(() => noteReconnect());
    });
    Then('the image is shown', imageShown);
    And('the file was fetched twice', () => {
      expect(openAttachment).toHaveBeenCalledTimes(2);
    });
  });

  Scenario('AC-2: returning to the foreground after a failed load retries once and the image shows', ({ Given, And, When, Then }) => {
    Given('an image attachment whose first load times out', timesOutOnce);
    And('the conversation is shown', shown);
    When('the app returns to the foreground', () => {
      act(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
    });
    Then('the image is shown', imageShown);
    And('the file was fetched twice', () => {
      expect(openAttachment).toHaveBeenCalledTimes(2);
    });
  });
});
