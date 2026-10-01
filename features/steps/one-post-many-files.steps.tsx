// features/steps/one-post-many-files.steps.tsx — runs features/one-post-many-files.feature
// (mw-909ci.3): the real sendToThread, plaintext codec, Conversation and Talk
// list; the upload, the delivery and the blob download are doubles.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, render, screen, waitFor, within, configure } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Conversation } from '../../src/cockpit/Conversation';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { sendToThread, type OutgoingFile } from '../../src/cockpit/send';
import { db, type MessageRow } from '../../src/data/db';
import { messagesRepo, viewRepo } from '../../src/data/repositories';
import { mergeConversation } from '../../src/model/conversation';
import { lock, setKey } from '../../src/services/keySession';
import { forgetOutboxState, kickOutbox, settledOutbox } from '../../src/services/outbox';
import { decodeThreadedMessage, encodeThreadedMessage, type ThreadedBody } from '../../src/services/threads';
import { fixtureView } from '../../tests/support/cockpit-fixture';

configure({ asyncUtilTimeout: 5000 });

const doubles = vi.hoisted(() => ({
  delivered: [] as { message: unknown }[],
  uploads: 0,
  failUpload: 0,
  key: new Uint8Array(32).fill(7),
}));

vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  deliverOptions: () => ({ key: doubles.key, mayorKey: '02'.padEnd(66, '0'), direct: true }),
}));
vi.mock('../../src/services/keySession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/keySession')>()),
  getKey: () => doubles.key,
}));
vi.mock('../../src/services/attachments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/attachments')>()),
  uploadAttachment: async ({ bytes, mime }: { bytes: Uint8Array; mime: string }) => {
    doubles.uploads += 1;
    if (doubles.failUpload === doubles.uploads) throw new Error('The upload failed');
    return { hash: `${bytes[0].toString(16).padStart(2, '0')}`.repeat(32), size: bytes.length + 100, mime };
  },
}));
vi.mock('../../src/services/deliver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/deliver')>()),
  deliverThreaded: async (message: unknown) => {
    doubles.delivered.push({ message });
    return { txid: 'ef'.repeat(32), channel: 'direct' };
  },
}));
vi.mock('../../src/services/blobs', () => ({ openAttachment: async () => 'blob:image' }));

const HASH_ONE = '01'.repeat(32);
const HASH_TWO = '02'.repeat(32);

let files: OutgoingFile[] = [];
let caption = '';
let sendError: unknown;
let plaintext = '';
const now = Date.now();

function image(first: number): OutgoingFile {
  return { name: `shot-${first}.png`, type: 'image/png', bytes: new Uint8Array([first, 2, 3]) };
}

function receivedRow(text: string): MessageRow {
  return {
    id: `${'cd'.repeat(32)}:0`,
    txid: 'cd'.repeat(32),
    vout: 0,
    seq: 1,
    class: 'message',
    to: '02'.padEnd(66, '0'),
    from: '03'.padEnd(66, '0'),
    ts: Math.floor(now / 1000),
    ciphertext: '',
    plaintext: text,
    direction: 'received',
    read: true,
  };
}

function delivered(): Record<string, unknown> {
  expect(doubles.delivered).toHaveLength(1);
  return JSON.parse(encodeThreadedMessage(doubles.delivered[0].message as ThreadedBody)) as Record<string, unknown>;
}

afterAll(() => {
  cleanup();
  lock();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/one-post-many-files.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    setKey(doubles.key);
    doubles.delivered = [];
    doubles.uploads = 0;
    doubles.failUpload = 0;
    files = [];
    caption = '';
    sendError = undefined;
    plaintext = '';
    forgetOutboxState();
    await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear(), db.outbox.clear()]);
  });

  const send = async () => {
    try {
      await sendToThread(undefined, caption, files);
      await act(async () => settledOutbox());
    } catch (err) {
      sendError = err;
    }
  };

  Scenario('mw-6ww.51: two images sent together are one message with attachments and one bubble showing both', ({ Given, When, Then, And }) => {
    Given('two images and the caption {string}', (_c, text: string) => {
      files = [image(1), image(2)];
      caption = text;
    });
    When('they are sent together to the general thread', send);
    Then('one message was delivered', async () => {
      await waitFor(() => expect(doubles.delivered).toHaveLength(1));
    });
    And('its plaintext has "attachments" with both hashes in order and the caption as its text', () => {
      const body = delivered();
      expect((body.attachments as { hash: string }[]).map((a) => a.hash)).toEqual([HASH_ONE, HASH_TWO]);
      expect(body.attachment).toBeUndefined();
      expect(body.text).toBe('the two screens');
      plaintext = JSON.stringify(body);
    });
    And('the conversation shows one message holding two images', async () => {
      render(<Conversation items={mergeConversation([receivedRow(plaintext)])} />);
      const bubbles = screen.getAllByTestId('message');
      expect(bubbles).toHaveLength(1);
      expect(await within(bubbles[0]).findAllByAltText('Attached image')).toHaveLength(2);
      expect(within(bubbles[0]).getByText('the two screens')).toBeInTheDocument();
    });
  });

  Scenario('one image is sent exactly as before', ({ Given, When, Then, And }) => {
    Given('one image and the caption {string}', (_c, text: string) => {
      files = [image(1)];
      caption = text;
    });
    When('they are sent together to the general thread', send);
    Then('one message was delivered', async () => {
      await waitFor(() => expect(doubles.delivered).toHaveLength(1));
    });
    And('its plaintext has "attachment" and no "attachments"', () => {
      const body = delivered();
      expect(body.attachment).toMatchObject({ hash: HASH_ONE, mime: 'image/png' });
      expect(body.attachments).toBeUndefined();
      expect(body.text).toBe('the one screen');
    });
  });

  Scenario('a failed upload of the second file sends nothing yet, and a later try uploads only that file', ({ Given, And, When, Then }) => {
    Given('two images and the caption {string}', (_c, text: string) => {
      files = [image(1), image(2)];
      caption = text;
    });
    And('the second upload fails', () => {
      doubles.failUpload = 2;
    });
    When('they are sent together to the general thread', send);
    Then('the message waits in the outbox for another try', async () => {
      expect(sendError).toBeUndefined();
      expect(await db.outbox.toArray()).toMatchObject([{ kind: 'message', state: 'pending', attempts: 1 }]);
    });
    And('no message was delivered', () => {
      expect(doubles.delivered).toHaveLength(0);
    });
    When('the sender tries again', async () => {
      await act(async () => {
        kickOutbox(true);
        await settledOutbox();
      });
    });
    Then('only the second file is uploaded again and one message is delivered', async () => {
      await waitFor(() => expect(doubles.delivered).toHaveLength(1));
      // the first try uploaded the first file and failed on the second; the second try uploaded the second alone
      expect(doubles.uploads).toBe(3);
      expect(delivered().attachments as { hash: string }[]).toHaveLength(2);
    });
  });

  Scenario('a message whose attachments array holds a malformed entry reads as plain text', ({ Given, Then, And }) => {
    Given('a received message whose attachments array holds a good entry and a malformed one', () => {
      plaintext = JSON.stringify({
        text: 'two pictures',
        attachments: [{ hash: HASH_ONE, size: 10, mime: 'image/png' }, { hash: HASH_TWO, size: 'big', mime: 'image/png' }],
      });
    });
    Then('it reads as plain text', () => {
      expect(decodeThreadedMessage(plaintext)).toEqual({ text: plaintext });
    });
    And('the conversation shows no image', () => {
      render(<Conversation items={mergeConversation([receivedRow(plaintext)])} />);
      expect(screen.getAllByTestId('message')).toHaveLength(1);
      expect(screen.queryByAltText('Attached image')).toBeNull();
    });
  });

  Scenario('the Talk list preview of a two-image post reads 2 images · <caption>', ({ Given, When, Then }) => {
    Given('a received post of two images with the caption {string}', (_c, text: string) => {
      plaintext = encodeThreadedMessage({
        text,
        attachments: [
          { hash: HASH_ONE, size: 10, mime: 'image/png' },
          { hash: HASH_TWO, size: 10, mime: 'image/jpeg' },
        ],
      });
    });
    When('Talk opens', async () => {
      await viewRepo.save({ plaintext: JSON.stringify(fixtureView(now)), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
      await messagesRepo.put(receivedRow(plaintext));
      window.history.replaceState(null, '', '/?v=talk');
      render(<TalkScreen thread={undefined} />);
      await screen.findByTestId('thread-list');
    });
    Then('the Factory row previews {string}', async (_c, preview: string) => {
      const row = (await within(screen.getByTestId('thread-list')).findByText('Factory')).closest('a') as HTMLElement;
      expect(await within(row).findByText(preview)).toBeInTheDocument();
    });
  });
});
