// features/steps/blob-loading.steps.tsx — runs features/blob-loading.feature
// (mw-gq6.284): the real Conversation, openAttachment, limiter and blob cache over real
// ciphertext; only the backend (fetch), the persistent store and IntersectionObserver are doubles.
import '@testing-library/react/dont-cleanup-after-each';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Conversation } from '../../src/cockpit/Conversation';
import { openAttachment, resetBlobSession, setBlobStore } from '../../src/services/blobs';
import { lock, setKey } from '../../src/services/keySession';
import type { ConversationItem } from '../../src/model/conversation';
import { FakeBlobStore } from '../../tests/support/fake-blob-store';
import { FakeBlobsBackend, FakeIntersectionObserver, PHONE_KEY, sentFile, type Served } from '../../tests/support/fake-blobs-backend';

let backend: FakeBlobsBackend;
let store: FakeBlobStore;
let files: Served[] = [];
let items: ConversationItem[] = [];
let opened: Promise<string[]>;

function item(file: Served, n: number): ConversationItem {
  return {
    id: `m${n}`,
    at: 1_760_000_000_000 + n * 1000,
    speaker: 'you',
    speakerLabel: 'You',
    kind: 'attachment',
    text: '',
    attachments: [{ hash: file.hash, size: file.size, mime: file.mime }],
    source: 'message',
  };
}

async function setUp(): Promise<void> {
  cleanup();
  vi.unstubAllGlobals();
  FakeIntersectionObserver.reset();
  backend = new FakeBlobsBackend();
  store = new FakeBlobStore();
  setBlobStore(store);
  resetBlobSession();
  vi.stubGlobal('fetch', backend.fetch);
  URL.createObjectURL = () => 'blob:image';
  setKey(PHONE_KEY);
}

async function conversationOf(count: number): Promise<void> {
  await setUp();
  files = [];
  for (let n = 0; n < count; n += 1) {
    const file = await sentFile(n);
    backend.add(file);
    files.push(file);
  }
  items = files.map(item);
}

async function imagesShown(count: number): Promise<void> {
  await waitFor(() => expect(screen.getAllByAltText('Attached image')).toHaveLength(count));
}

afterAll(() => {
  cleanup();
  lock();
  vi.unstubAllGlobals();
});

const feature = await loadFeature('features/blob-loading.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('AC-1: a conversation with 20 attachments of which 3 are near the viewport fetches 3 blobs', ({ Given, When, Then }) => {
    Given('a conversation of 20 attachments, each its own file', () => conversationOf(20));
    When('it is shown and 3 of the attachments are near the viewport', async () => {
      vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
      render(<Conversation items={items} />);
      const watched = FakeIntersectionObserver.allWatched();
      expect(watched).toHaveLength(20);
      for (const el of watched.slice(-3)) FakeIntersectionObserver.nearViewport(el);
      await imagesShown(3);
    });
    Then('3 blobs were fetched from the backend', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(backend.blobRequests).toHaveLength(3);
      expect(backend.blobRequests.sort()).toEqual(files.slice(-3).map((f) => f.hash).sort());
    });
  });

  Scenario('AC-2: re-opening a conversation after a reload fetches no blob from the network', ({ Given, And, When, Then }) => {
    Given('a conversation of 3 attachments, each its own file', () => conversationOf(3));
    And('it was shown and all its images loaded', async () => {
      render(<Conversation items={items} />);
      await imagesShown(3);
      expect(backend.blobRequests).toHaveLength(3);
      expect(store.entries.size).toBe(3);
    });
    When('the page is loaded again and the conversation is shown', () => {
      cleanup();
      resetBlobSession();
      backend.blobRequests = [];
      backend.challenges = 0;
      render(<Conversation items={items} />);
    });
    Then('all its images show again', () => imagesShown(3));
    And('no blob was fetched from the backend since the reload', () => {
      expect(backend.blobRequests).toHaveLength(0);
      expect(backend.challenges).toBe(0);
    });
  });

  Scenario('AC-3: two attachments with the same hash shown at once make one fetch', ({ Given, When, Then, And }) => {
    Given('a conversation of two attachments that are the same file', async () => {
      await conversationOf(1);
      items = [item(files[0], 0), item(files[0], 1)];
    });
    When('it is shown', () => {
      render(<Conversation items={items} />);
    });
    Then('both images show', () => imagesShown(2));
    And('1 blob was fetched from the backend', () => {
      expect(backend.blobRequests).toHaveLength(1);
    });
  });

  Scenario('AC-4: with 10 blob requests queued never more than 4 are in flight and each challenge is fetched when its request leaves the queue', ({ Given, When, Then, And }) => {
    Given('10 attachments on the backend, which answers only when told to', async () => {
      await conversationOf(10);
      backend.holdAnswers();
    });
    When('all 10 are asked for at once', () => {
      opened = Promise.all(files.map((file) => openAttachment(file, { key: PHONE_KEY, direction: 'sent', fetchImpl: backend.fetch })));
    });
    Then('4 blobs are in flight and 4 challenges have been fetched', async () => {
      await waitFor(() => expect(backend.held).toBe(4));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(backend.inFlight).toBe(4);
      expect(backend.challenges).toBe(4);
    });
    When('the backend answers them one at a time', async () => {
      for (let answered = 0; answered < 10; answered += 1) {
        await waitFor(() => expect(backend.held).toBeGreaterThan(0));
        backend.releaseOne();
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });
    Then('no more than 4 blobs were ever in flight', () => {
      expect(backend.maxInFlight).toBe(4);
    });
    And('no challenge was fetched before its request left the queue', () => {
      expect(backend.challenges).toBe(10);
      expect(backend.maxSignedWaiting).toBeLessThanOrEqual(4);
    });
    And('all 10 attachments opened', async () => {
      expect(await opened).toHaveLength(10);
    });
  });
});
