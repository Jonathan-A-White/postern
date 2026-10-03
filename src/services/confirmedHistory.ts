// src/services/confirmedHistory.ts — an address's whole confirmed history from WhatsOnChain,
// paged. Its /history holds only the newest 100 transactions, which a key that broadcasts its
// own records outgrows; the licence check (licence.ts) and the issuer's list (issue.ts) both
// read through this. Failures are plain Errors: issue.ts turns them into its network error.
import { chainConfig, type AddressHistoryEntry, type ChainProvider } from 'spell-forge-bsv';

/** WhatsOnChain serves 100 transactions a page; past this many pages a history is not read (as the backend's reader). */
const MAX_HISTORY_PAGES = 50;
export const HISTORY_PAGE_DELAY_MS = 350;
const HISTORY_ATTEMPTS = 3;
const HISTORY_RETRY_DELAY_MS = 500;

/** How a history is read when no chain provider is handed in. */
export interface HistoryReadOptions {
  /** Pause between two pages of WhatsOnChain's history; its free tier allows about three requests a second. */
  historyPageDelayMs?: number;
}

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

interface HistoryPage {
  result?: Array<{ tx_hash: string; height?: number }>;
  nextPageToken?: string;
  error?: string;
}

async function fetchHistoryPage(url: string): Promise<HistoryPage> {
  let retryDelay = HISTORY_RETRY_DELAY_MS;
  for (let attempt = 1; ; attempt++) {
    let response: Response | undefined;
    try {
      response = await globalThis.fetch(url);
    } catch {
      // A rate-limited reply has no CORS header, so a browser sees it as a failed fetch.
      if (attempt === HISTORY_ATTEMPTS) {
        throw new Error('Could not reach WhatsOnChain after 3 tries (offline, or rate-limited: its 429 reply carries no CORS header)');
      }
    }
    if (response?.ok) return (await response.json()) as HistoryPage;
    if (response && response.status !== 429) throw new Error(`WhatsOnChain said ${response.status} reading the history`);
    if (response && attempt === HISTORY_ATTEMPTS) throw new Error('WhatsOnChain rate-limited the request (429) after retries');
    await sleep(retryDelay);
    retryDelay *= 2;
  }
}

/**
 * The whole confirmed history of `address`, oldest first. WhatsOnChain's /history holds only
 * the newest 100 transactions, so this pages /confirmed/history by nextPageToken (newest
 * page first). Past MAX_HISTORY_PAGES it throws: a list missing its oldest pages would read
 * as a key that issued nothing.
 */
export async function readConfirmedHistory(address: string, pageDelayMs: number): Promise<AddressHistoryEntry[]> {
  const pages: HistoryPage[] = [];
  let token = '';
  for (;;) {
    if (pages.length === MAX_HISTORY_PAGES) {
      throw new Error(`The history of this key runs past ${MAX_HISTORY_PAGES} pages, more than can be read here.`);
    }
    if (pages.length > 0) await sleep(pageDelayMs);
    const query = token ? `?token=${encodeURIComponent(token)}` : '';
    const page = await fetchHistoryPage(`${chainConfig.providerBaseUrl}/address/${address}/confirmed/history${query}`);
    if (page.error) throw new Error(`WhatsOnChain could not read the history: ${page.error}`);
    pages.push(page);
    if (!page.nextPageToken) break;
    token = page.nextPageToken;
  }
  return pages
    .reverse()
    .flatMap((page) => page.result ?? [])
    .map((entry) => ({ txid: entry.tx_hash, height: entry.height ?? 0 }))
    .sort((a, b) => a.height - b.height);
}

/** The library's provider, but reading the confirmed history whole (its /history holds only the newest 100). */
export function withWholeHistory(provider: ChainProvider, pageDelayMs: number): ChainProvider {
  const whole: ChainProvider = {
    getUtxos: (address) => provider.getUtxos(address),
    getTransactionHex: (txid) => provider.getTransactionHex(txid),
    broadcast: (hex) => provider.broadcast(hex),
    getAddressHistory: (address) => readConfirmedHistory(address.trim(), pageDelayMs),
  };
  if (provider.getUnconfirmedAddressHistory) {
    whole.getUnconfirmedAddressHistory = (address) => provider.getUnconfirmedAddressHistory!(address);
  }
  return whole;
}
