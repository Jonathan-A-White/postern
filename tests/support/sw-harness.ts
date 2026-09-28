// tests/support/sw-harness.ts — loads src/sw.ts under jsdom as if it were the
// service worker: `self` is the jsdom window, given the few
// ServiceWorkerGlobalScope members the worker touches (clients, registration,
// __WB_MANIFEST), and every listener it registers is captured so a test can
// fire a `push` or `notificationclick` at it.
import { vi } from 'vitest';

vi.mock('workbox-precaching', () => ({ precacheAndRoute: vi.fn() }));

export interface FakeWindowClient {
  url: string;
  focus: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
}

export interface WorkerHarness {
  /** Windows the worker's clients.matchAll() reports as open. */
  openWindows: FakeWindowClient[];
  openWindow: ReturnType<typeof vi.fn>;
  shown: Array<{ title: string; options: Record<string, unknown> }>;
  push(payload: Record<string, unknown>): Promise<void>;
  click(notification: { data?: unknown }): Promise<void>;
}

export function fakeWindowClient(url = 'https://postern.allmymind.org/?v=needs'): FakeWindowClient {
  return { url, focus: vi.fn(async () => undefined), postMessage: vi.fn() };
}

let loaded: WorkerHarness | undefined;

export async function loadWorker(): Promise<WorkerHarness> {
  if (loaded) {
    loaded.openWindows.length = 0;
    loaded.shown.length = 0;
    loaded.openWindow.mockClear();
    return loaded;
  }
  const handlers = new Map<string, (event: unknown) => void>();
  const realAdd = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, listener: (event: unknown) => void, ...rest: unknown[]) => {
    if (type === 'push' || type === 'notificationclick' || type === 'fetch') handlers.set(type, listener);
    else (realAdd as (...args: unknown[]) => void)(type, listener, ...rest);
  }) as typeof window.addEventListener);

  const harness: WorkerHarness = {
    openWindows: [],
    openWindow: vi.fn(async () => null),
    shown: [],
    async push(payload) {
      const waits: Promise<unknown>[] = [];
      handlers.get('push')?.({ data: { json: () => payload }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
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
    registration: { showNotification: vi.fn(async (title: string, options: Record<string, unknown>) => void harness.shown.push({ title, options })) },
  });
  await import('../../src/sw');
  loaded = harness;
  return harness;
}
