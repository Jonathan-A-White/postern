// tests/support/fake-blobs-backend.ts — a backend double for /api/challenge and
// GET /api/blobs/{hash} over real ciphertext (what the Mayor, or this phone, uploaded),
// counting what reached it. `hold` makes blob answers wait until `release` is called.
import { PrivateKey, Utils } from '@bsv/sdk';
import { encryptAttachment } from '../../src/services/messages';
import { challengeResponse, isChallengeRequest } from './challenge-fetch';

export const PHONE_KEY = new Uint8Array(32).fill(7);

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Utils.toHex(Array.from(new Uint8Array(digest)));
}

export interface Served {
  hash: string;
  size: number;
  mime: string;
  plain: Uint8Array;
  ciphertext: Uint8Array;
}

/** A file this phone sent: encrypted to a stranger's key, readable back by the phone's key as the sender. */
export async function sentFile(n: number): Promise<Served> {
  const plain = new Uint8Array([137, 80, 78, 71, n, 1, 2, 3]);
  const ciphertext = encryptAttachment({
    bytes: plain,
    senderPrivateKeyHex: Utils.toHex(Array.from(PHONE_KEY)),
    recipientPublicKeyHex: PrivateKey.fromRandom().toPublicKey().toString(),
  });
  return { hash: await sha256Hex(ciphertext), size: ciphertext.length, mime: 'image/png', plain, ciphertext };
}

export class FakeBlobsBackend {
  readonly served = new Map<string, Served>();
  challenges = 0;
  blobRequests: string[] = [];
  inFlight = 0;
  maxInFlight = 0;
  completed = 0;
  /** The most challenges fetched whose blob answer had not yet come back. */
  maxSignedWaiting = 0;
  private hold = false;
  private waiting: (() => void)[] = [];

  add(file: Served): void {
    this.served.set(file.hash, file);
  }

  holdAnswers(): void {
    this.hold = true;
  }

  /** Lets the oldest held blob answer go. */
  releaseOne(): void {
    this.waiting.shift()?.();
  }

  get held(): number {
    return this.waiting.length;
  }

  fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (isChallengeRequest(url)) {
      this.challenges += 1;
      this.maxSignedWaiting = Math.max(this.maxSignedWaiting, this.challenges - this.completed);
      return challengeResponse();
    }
    const hash = url.split('/blobs/')[1];
    this.blobRequests.push(hash);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    if (this.hold) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.inFlight -= 1;
    this.completed += 1;
    const file = this.served.get(hash);
    if (!file) return new Response('', { status: 404 });
    return new Response(new Uint8Array(file.ciphertext), { status: 200 });
  };
}

/** An IntersectionObserver double: the test says which watched elements are near the viewport. */
export class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly watched: Element[] = [];
  private readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIntersectionObserver.instances.push(this);
  }
  observe(el: Element): void {
    this.watched.push(el);
  }
  unobserve(el: Element): void {
    this.watched.splice(this.watched.indexOf(el), 1);
  }
  disconnect(): void {
    this.watched.length = 0;
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  static reset(): void {
    FakeIntersectionObserver.instances = [];
  }
  static allWatched(): Element[] {
    return FakeIntersectionObserver.instances.flatMap((o) => o.watched);
  }
  /** Reports `el` as near the viewport to whichever observer is watching it. */
  static nearViewport(el: Element): void {
    const observer = FakeIntersectionObserver.instances.find((o) => o.watched.includes(el));
    observer?.callback([{ target: el, isIntersecting: true } as IntersectionObserverEntry], observer as unknown as IntersectionObserver);
  }
}
