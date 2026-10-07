// features/steps/any-file.steps.tsx — runs features/any-file.feature (mw-gq6.289): the real
// Composer, sendToThread, outbox, uploadAttachment (against a stubbed fetch) and Conversation;
// the delivery and the blob download are doubles.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey } from '@bsv/sdk';
import { Composer } from '../../src/cockpit/Composer';
import { Conversation } from '../../src/cockpit/Conversation';
import { ToastHost } from '../../src/ui/toast';
import { dismissAllToasts } from '../../src/ui/toastStore';
import { db, type MessageRow } from '../../src/data/db';
import { mergeConversation } from '../../src/model/conversation';
import { lock, setKey } from '../../src/services/keySession';
import { forgetOutboxState, settledOutbox } from '../../src/services/outbox';
import { encodeThreadedMessage, type Attachment } from '../../src/services/threads';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

configure({ asyncUtilTimeout: 5000 });

const doubles = vi.hoisted(() => ({
  delivered: [] as { attachments?: Attachment[]; attachment?: Attachment }[],
  uploads: 0,
  key: new Uint8Array(32).fill(7),
  mayorKey: '',
}));

doubles.mayorKey = PrivateKey.fromRandom().toPublicKey().toString();

vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  deliverOptions: () => ({ key: doubles.key, mayorKey: doubles.mayorKey, direct: true }),
}));
vi.mock('../../src/services/keySession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/keySession')>()),
  getKey: () => doubles.key,
}));
vi.mock('../../src/services/deliver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/deliver')>()),
  deliverThreaded: async (message: { attachments?: Attachment[]; attachment?: Attachment }) => {
    doubles.delivered.push(message);
    return { txid: 'ef'.repeat(32), channel: 'direct' };
  },
}));
vi.mock('../../src/services/blobs', () => ({ openAttachment: async () => 'blob:file' }));

const MIB = 1024 * 1024;
const now = Date.now();
let plaintext = '';
let downloads: string[] = [];

function fileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
}

function attach(files: File[]): void {
  fireEvent.change(fileInput(), { target: { files } });
}

function attachments(): Attachment[] {
  expect(doubles.delivered).toHaveLength(1);
  const [message] = doubles.delivered;
  return message.attachments ?? (message.attachment ? [message.attachment] : []);
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

afterAll(() => {
  cleanup();
  lock();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const feature = await loadFeature('features/any-file.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    dismissAllToasts();
    vi.restoreAllMocks();
    setKey(doubles.key);
    doubles.delivered = [];
    doubles.uploads = 0;
    downloads = [];
    plaintext = '';
    forgetOutboxState();
    await Promise.all([db.settings.clear(), db.messages.clear(), db.outbox.clear()]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (isChallengeRequest(url)) return challengeResponse();
        if (url.endsWith('/blobs')) {
          doubles.uploads += 1;
          return new Response(JSON.stringify({ hash: String(doubles.uploads).padStart(2, '0').repeat(32), size: 100 + doubles.uploads }), { status: 201, headers: { 'Content-Type': 'application/json' } });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
  });

  const open = () => {
    render(
      <>
        <Composer thread={undefined} />
        <ToastHost />
      </>,
    );
  };
  const tapSend = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => settledOutbox());
  };

  Scenario('AC-1: a markdown file and a zip attached together go out as one message, each with its own type and name', ({ Given, When, And, Then }) => {
    Given('the composer is open', open);
    When('he attaches {string} of type {string} and {string} of type {string} with Attach files', async (_c, nameA: string, typeA: string, nameB: string, typeB: string) => {
      await act(async () => attach([new File(['# notes'], nameA, { type: typeA }), new File([new Uint8Array([80, 75, 3, 4])], nameB, { type: typeB })]));
      await screen.findByLabelText(`Remove ${nameB}`);
    });
    And('he taps Send', tapSend);
    Then('one message is delivered with two attachments', async () => {
      await waitFor(() => expect(doubles.delivered).toHaveLength(1));
      expect(attachments()).toHaveLength(2);
    });
    And('attachment 1 has mime {string} and name {string}', (_c, mime: string, name: string) => {
      expect(attachments()[0]).toMatchObject({ mime, name });
    });
    And('attachment 2 has mime {string} and name {string}', (_c, mime: string, name: string) => {
      expect(attachments()[1]).toMatchObject({ mime, name });
    });
  });

  Scenario('AC-2: a file whose type the phone does not report is sent as application/octet-stream with its name', ({ Given, When, And, Then }) => {
    Given('the composer is open', open);
    When('he attaches {string} of no type with Attach files', async (_c, name: string) => {
      await act(async () => attach([new File(['all: build'], name)]));
      await screen.findByLabelText(`Remove ${name}`);
    });
    And('he taps Send', tapSend);
    Then('one message is delivered with one attachment', async () => {
      await waitFor(() => expect(doubles.delivered).toHaveLength(1));
      expect(attachments()).toHaveLength(1);
    });
    And('attachment 1 has mime {string} and name {string}', (_c, mime: string, name: string) => {
      expect(attachments()[0]).toMatchObject({ mime, name });
    });
  });

  Scenario('AC-2: a file over 8 MiB is still refused', ({ Given, When, Then, And }) => {
    Given('the composer is open', open);
    When('he attaches {string} of 9 MiB with Attach files', async (_c, name: string) => {
      await act(async () => attach([new File([new Uint8Array(9 * MIB)], name, { type: 'application/octet-stream' })]));
    });
    Then('he is told {string}', async (_c, words: string) => {
      expect(await screen.findByText(words)).toBeInTheDocument();
    });
    And('nothing is waiting to be sent', () => {
      expect(screen.queryByLabelText('To send')).toBeNull();
    });
  });

  Scenario('AC-3: a received file of a type the app does not show is a file chip that downloads on tap', ({ Given, When, Then }) => {
    Given('a received message with a file {string} of type {string} and {int} bytes', (_c, name: string, mime: string, size: number) => {
      plaintext = encodeThreadedMessage({ text: '', attachment: { hash: '01'.repeat(32), size, mime, name } });
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push(this.download);
      });
    });
    When('the conversation is shown', () => {
      render(<Conversation items={mergeConversation([receivedRow(plaintext)])} />);
    });
    Then('it shows the file {string} with its size {string}', (_c, name: string, size: string) => {
      const chip = within(screen.getByTestId('message')).getByRole('button', { name: new RegExp(name) });
      expect(chip).toHaveTextContent(`${name} · ${size}`);
    });
    When('he taps the file {string}', (_c, name: string) => {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }));
    });
    Then('the file is downloaded as {string}', async (_c, name: string) => {
      await waitFor(() => expect(downloads).toEqual([name]));
    });
  });
});
