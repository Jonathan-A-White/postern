// tests/support/sw-harness.ts — loads src/sw.ts under jsdom as if it were the
// service worker: `self` is the jsdom window, given the few
// ServiceWorkerGlobalScope members the worker touches (clients, registration,
// __WB_MANIFEST), and every listener it registers is captured so a test can
// fire a `push` or `notificationclick` at it.
import { vi } from 'vitest';

vi.mock('workbox-precaching', () => ({ precacheAndRoute: vi.fn() }));

export interface FakeWindowClient {
  url: string;
  focused: boolean;
  visibilityState: 'visible' | 'hidden';
  focus: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
}

export interface WorkerHarness {
  /** Windows the worker's clients.matchAll() reports as open. */
  openWindows: FakeWindowClient[];
  openWindow: ReturnType<typeof vi.fn>;
  shown: Array<{ title: string; options: Record<string, unknown> }>;
  /** Notifications the worker showed and nobody has closed yet. */
  open: FakeNotification[];
  push(payload: Record<string, unknown>): Promise<void>;
  /** A message a window posts to the worker (navigator.serviceWorker's postMessage). */
  deliver(data: unknown): Promise<void>;
  /** A tap on the notification, or on one of its buttons when `action` names it ('' is the body). */
  click(notification: { data?: unknown }, action?: string): Promise<void>;
  /** The 'activate' event: resolves when everything the worker handed waitUntil has settled. */
  activate(): Promise<void>;
  /** self.skipWaiting(), which the worker calls when a window posts {type:'SKIP_WAITING'}. */
  skipWaiting: ReturnType<typeof vi.fn>;
  /** clients.claim(), which the worker calls on activate. */
  claim: ReturnType<typeof vi.fn>;
  /** A GET the page makes through the worker: the response the worker answered with, or undefined when it did not respond (the browser goes to the network itself). */
  fetch(url: string, method?: string): Promise<Response | undefined>;
}

export interface FakeNotification {
  tag?: string;
  data?: unknown;
  close: ReturnType<typeof vi.fn>;
}

/** A window the worker finds in clients.matchAll(): focused and visible unless told otherwise. */
export function fakeWindowClient(url = 'https://postern.allmymind.org/?v=needs'): FakeWindowClient {
  return { url, focused: true, visibilityState: 'visible', focus: vi.fn(async () => undefined), postMessage: vi.fn() };
}

let loaded: { account: string; harness: WorkerHarness } | undefined;
const realAddEventListener = window.addEventListener.bind(window);

/** The scope an account's push-only registration has (src/push/accountScope.ts), as a browser reports it. */
export function accountScopeUrl(accountId: string): string {
  return `https://postern.allmymind.org/push-account/${accountId}/`;
}

export interface LoadWorkerOptions {
  /** The account whose push registration this worker runs in; none is the app's own registration (account 1, as before). Asking for another account than the last load's makes a fresh worker, and the earlier one stops being the one `self` is. */
  account?: string;
}

export async function loadWorker(options: LoadWorkerOptions = {}): Promise<WorkerHarness> {
  const account = options.account ?? '1';
  if (loaded && loaded.account === account) {
    const reused = loaded.harness;
    reused.openWindows.length = 0;
    reused.shown.length = 0;
    reused.open.length = 0;
    reused.openWindow.mockClear();
    reused.skipWaiting.mockClear();
    reused.claim.mockClear();
    return reused;
  }
  if (loaded) vi.resetModules();
  const handlers = new Map<string, Array<(event: unknown) => void>>();
  const realAdd = realAddEventListener;
  vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, listener: (event: unknown) => void, ...rest: unknown[]) => {
    if (type === 'push' || type === 'notificationclick' || type === 'fetch' || type === 'message' || type === 'activate') handlers.set(type, [...(handlers.get(type) ?? []), listener]);
    else (realAdd as (...args: unknown[]) => void)(type, listener, ...rest);
  }) as typeof window.addEventListener);

  const harness: WorkerHarness = {
    openWindows: [],
    openWindow: vi.fn(async () => null),
    skipWaiting: vi.fn(async () => undefined),
    claim: vi.fn(async () => undefined),
    shown: [],
    open: [],
    async push(payload) {
      const waits: Promise<unknown>[] = [];
      for (const h of handlers.get('push') ?? []) h({ data: { json: () => payload }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
      await Promise.all(waits);
    },
    async deliver(data) {
      const waits: Promise<unknown>[] = [];
      for (const h of handlers.get('message') ?? []) h({ data, waitUntil: (p: Promise<unknown>) => waits.push(p) });
      await Promise.all(waits);
    },
    async click(notification, action = '') {
      const waits: Promise<unknown>[] = [];
      for (const h of handlers.get('notificationclick') ?? []) h({ notification: { ...notification, close: vi.fn() }, action, waitUntil: (p: Promise<unknown>) => waits.push(p) });
      await Promise.all(waits);
    },
    async activate() {
      const waits: Promise<unknown>[] = [];
      for (const h of handlers.get('activate') ?? []) h({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
      await Promise.all(waits);
    },
    async fetch(url, method = 'GET') {
      let answer: Promise<Response> | undefined;
      const request = { url, method, mode: 'no-cors', destination: '' } as unknown as Request;
      for (const h of handlers.get('fetch') ?? []) {
        h({ request, respondWith: (p: Promise<Response>) => (answer ??= p) });
        if (answer) break;
      }
      return answer;
    },
  };
  Object.assign(window, {
    __WB_MANIFEST: [],
    skipWaiting: harness.skipWaiting,
    clients: { matchAll: vi.fn(async () => harness.openWindows), openWindow: harness.openWindow, claim: harness.claim },
    registration: {
      scope: options.account ? accountScopeUrl(options.account) : 'https://postern.allmymind.org/',
      showNotification: vi.fn(async (title: string, options: Record<string, unknown>) => {
        harness.shown.push({ title, options });
        const notification: FakeNotification = {
          tag: options.tag as string | undefined,
          data: options.data,
          close: vi.fn(() => void harness.open.splice(harness.open.indexOf(notification), 1)),
        };
        harness.open.push(notification);
      }),
      getNotifications: vi.fn(async (filter?: { tag?: string }) => harness.open.filter((n) => filter?.tag === undefined || n.tag === filter.tag)),
    },
  });
  await import('../../src/sw');
  loaded = { account, harness };
  return harness;
}
