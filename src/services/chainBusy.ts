// src/services/chainBusy.ts — a WhatsOnChain that is busy, told apart from one that refused, and tried again.
// The backend relays the provider's refusal whole in its 502 (`WhatsOnChain said 429: <html>…`), and the
// chain library words its own ("rate-limited the request (429)", "Could not reach WhatsOnChain after 3 tries");
// a busy one clears in seconds, so Issue waits and asks again rather than print a page of someone else's HTML
// (mw-rch8bu). Not chain code: it reads only the words of an error.

/** Waits before each new try: four tries over thirty seconds. */
export const BUSY_RETRY_DELAYS_MS = [5_000, 10_000, 15_000];

let delays: number[] = BUSY_RETRY_DELAYS_MS;

/** Tests shorten the waits; no argument restores them. */
export function setBusyRetryDelaysMs(next: number[] | undefined): void {
  delays = next ?? BUSY_RETRY_DELAYS_MS;
}

/** rate-limited: a 429, which the provider refuses before it looks at anything. trouble: a 5xx. unreachable: the fetch itself failed (its 429 carries no CORS header, so a browser cannot tell the two apart). */
export type BusyKind = 'rate-limited' | 'trouble' | 'unreachable';

export interface Busy {
  kind: BusyKind;
  /** The provider's HTTP status, when the words carry one. */
  status?: number;
  /** What the provider sent with it: for the console, never the screen. */
  body: string;
}

/** The provider's status and body in `message`, when it is the backend's relay of a refusal (`WhatsOnChain said 503: …`). */
export function providerRefusal(message: string): { status: number; body: string } | null {
  const said = /WhatsOnChain said (\d{3})(?:: ([\s\S]*))?/.exec(message);
  return said ? { status: Number(said[1]), body: (said[2] ?? '').trim() } : null;
}

/** Whether `error` says WhatsOnChain is busy (a 429, a 5xx, or not reachable), and how. */
export function busyOf(error: unknown): Busy | null {
  const message = error instanceof Error ? error.message : '';
  const refusal = providerRefusal(message);
  if (refusal?.status === 429) return { kind: 'rate-limited', status: 429, body: refusal.body };
  if (refusal && refusal.status >= 500) return { kind: 'trouble', status: refusal.status, body: refusal.body };
  if (/rate-limited the request \(429\)/.test(message)) return { kind: 'rate-limited', status: 429, body: message };
  if (/Could not reach WhatsOnChain/.test(message)) return { kind: 'unreachable', body: message };
  return null;
}

/**
 * `error`'s words for the screen: a relayed WhatsOnChain refusal whose body is a page, or a 429, becomes one plain line
 * (the body goes to the console); anything else is its own message.
 */
export function plainMessage(error: unknown): string {
  const message = error instanceof Error && error.message ? error.message : 'Something went wrong.';
  const refusal = providerRefusal(message);
  // A short plain-text reason (a node's "rejected the transaction") is worth reading; a page of HTML or a 429 is not.
  if (!refusal || (refusal.status !== 429 && refusal.body.length <= 200 && !/[<>]/.test(refusal.body))) return message;
  console.warn('WhatsOnChain refused a request:', message);
  return busyOf(error)?.kind === 'rate-limited'
    ? 'WhatsOnChain is rate-limiting us. Try again in a minute.'
    : `WhatsOnChain answered ${refusal.status}. Try again in a minute.`;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `call`, and while it fails with a busy WhatsOnChain that `retryable` allows, says so through `onBusy`,
 * waits and runs it again (BUSY_RETRY_DELAYS_MS). Any other failure, and the last busy one, are thrown as they came.
 */
export async function retryWhenBusy<T>(call: () => Promise<T>, onBusy?: () => void, retryable: (busy: Busy) => boolean = () => true): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const busy = busyOf(error);
      if (!busy || !retryable(busy) || attempt >= delays.length) throw error;
      onBusy?.();
      await sleep(delays[attempt]);
    }
  }
}
