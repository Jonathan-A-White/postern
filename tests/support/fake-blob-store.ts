// tests/support/fake-blob-store.ts — a BlobStore double (src/services/blobStore.ts):
// what a phone's persistent store would hold, readable back by the test.
import type { BlobStore } from '../../src/services/blobStore';

export class FakeBlobStore implements BlobStore {
  readonly entries = new Map<string, Uint8Array>();
  async get(hash: string): Promise<Uint8Array | undefined> {
    return this.entries.get(hash);
  }
  async put(hash: string, bytes: Uint8Array): Promise<void> {
    this.entries.set(hash, new Uint8Array(bytes));
  }
}
