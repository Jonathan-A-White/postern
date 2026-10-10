// tests/support/woc-stub.ts — a fetch standing in for WhatsOnChain testnet's address and
// transaction reads, recording every request, for the tests that count how many times the
// phone asks (docs/key-screen-reads.md). Pages are served newest first by nextPageToken.
import { vi } from 'vitest';

export interface WocStubOptions {
  /** The confirmed history, one array per page, newest page first. */
  pages: Array<Array<{ tx_hash: string; height: number }>>;
  /** The mempool transactions of /unconfirmed/history. */
  unconfirmed?: Array<{ tx_hash: string; height: number }>;
  hexByTxid: Record<string, string>;
  /** The satoshis of the one coin /unspent lists. */
  balance?: number;
  /**
   * WhatsOnChain's free tier: a request that starts under `gapMs` after the previous one, or that is more
   * than `perWindow` in `windowMs`, is rate-limited. Its 429 carries no CORS header, so a browser's fetch
   * rejects (as here) rather than reading a status. A refused request still counts as started.
   */
  rateLimit?: { gapMs: number; perWindow: number; windowMs: number };
}

export interface WocStub {
  /** Every request so far: pathname plus search, in the order made. */
  requested: string[];
  /** When each request arrived, in ms on the monotonic clock (performance.now), so a wall clock that steps back cannot make a gap negative. */
  at: number[];
  /** Transactions whose /hex answers like a rate-limited fetch (a rejection) while in this set. */
  failingHex: Set<string>;
  /** How many requests the rate limit refused. */
  refused: { count: number };
  fetchImpl: ReturnType<typeof vi.fn>;
}

export function wocStub(options: WocStubOptions): WocStub {
  const requested: string[] = [];
  const at: number[] = [];
  const failingHex = new Set<string>();
  const refused = { count: 0 };
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requested.push(url.pathname + url.search);
    const now = performance.now();
    const previous = at.at(-1);
    at.push(now);
    const limit = options.rateLimit;
    if (limit && ((previous !== undefined && now - previous < limit.gapMs) || at.filter((time) => now - time < limit.windowMs).length > limit.perWindow)) {
      refused.count++;
      throw new TypeError('Failed to fetch');
    }
    if (url.pathname.endsWith('/confirmed/history')) {
      const token = url.searchParams.get('token');
      const index = token === null ? 0 : Number(token.replace('page-', ''));
      const more = index + 1 < options.pages.length;
      return new Response(JSON.stringify({ result: options.pages[index], nextPageToken: more ? `page-${index + 1}` : '', error: '' }), { status: 200 });
    }
    if (url.pathname.endsWith('/unconfirmed/history')) {
      return new Response(JSON.stringify({ result: options.unconfirmed ?? [], nextPageToken: '', error: '' }), { status: 200 });
    }
    if (url.pathname.endsWith('/unspent')) {
      const coins = options.balance ? [{ tx_hash: 'c'.repeat(64), tx_pos: 0, value: options.balance, height: 100 }] : [];
      return new Response(JSON.stringify(coins), { status: 200 });
    }
    const hexMatch = /\/tx\/([0-9a-f]{64})\/hex$/.exec(url.pathname);
    if (hexMatch && failingHex.has(hexMatch[1])) throw new TypeError('Failed to fetch');
    if (hexMatch && options.hexByTxid[hexMatch[1]]) return new Response(options.hexByTxid[hexMatch[1]], { status: 200 });
    return new Response('not found', { status: 404 });
  });
  return { requested, at, failingHex, refused, fetchImpl };
}
