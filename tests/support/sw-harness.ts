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
  click(notification: { data?: unknown }): Promise<void>;
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

let loaded: WorkerHarness | undefined;

export async function loadWorker(): Promise<WorkerHarness> {
  if (loaded) {
    loaded.openWindows.length = 0;
    loaded.shown.length = 0;
    loaded.open.length = 0;
    loaded.openWindow.mockClear();
    return loaded;
  }
  const handlers = new Map<string, (event: unknown) => void>();
  const realAdd = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, listener: (event: unknown) => void, ...rest: unknown[]) => {
    if (type === 'push' || type === 'notificationclick' || type === 'fetch' || type === 'message') handlers.set(type, listener);
    else (realAdd as (...args: unknown[]) => void)(type, listener, ...rest);
  }) as typeof window.addEventListener);

  const harness: WorkerHarness = {
    openWindows: [],
    openWindow: vi.fn(async () => null),
    shown: [],
    open: [],
    async push(payload) {
      const waits: Promise<unknown>[] = [];
      handlers.get('push')?.({ data: { json: () => payload }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
      await Promise.all(waits);
    },
    async deliver(data) {
      const waits: Promise<unknown>[] = [];
      handlers.get('message')?.({ data, waitUntil: (p: Promise<unknown>) => waits.push(p) });
      await Promise.all(waits);
    },
    async click(notification) {
      const waits: Promise<unknown>[] = [];
      handlers.get('notificationclick')?.({ notification: { ...notification, close: vi.fn() }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
      await Promise.all(waits);
    },
  };
  Object.assign(window, {
    __WB_MANIFEST: [],
    clients: { matchAll: vi.fn(async () => harness.openWindows), openWindow: harness.openWindow },
    registration: {
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
  loaded = harness;
  return harness;
}
