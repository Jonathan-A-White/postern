// tests/support/fake-registration.ts — a service worker container and registration the app-update
// logic (src/services/appUpdate.ts) can watch: a worker can be put in waiting, an update found, and a
// new worker take control, as the browser would, without a browser.
import { vi, type Mock } from 'vitest';

type Listener = () => void;

export interface FakeWorker {
  state: ServiceWorkerState;
  postMessage: Mock<(...args: never[]) => unknown>;
  addEventListener(type: string, listener: Listener): void;
  /** Moves the worker to `state` and tells its statechange listeners. */
  become(state: ServiceWorkerState): void;
}

export function fakeWorker(state: ServiceWorkerState = 'installed'): FakeWorker {
  const listeners: Listener[] = [];
  const worker: FakeWorker = {
    state,
    postMessage: vi.fn(),
    addEventListener: (_type, listener) => void listeners.push(listener),
    become(next) {
      worker.state = next;
      for (const listener of listeners) listener();
    },
  };
  return worker;
}

export interface FakeSetup {
  container: { controller: unknown; addEventListener(type: string, listener: Listener): void; removeEventListener(type: string, listener: Listener): void };
  registration: {
    waiting: FakeWorker | null;
    installing: FakeWorker | null;
    update: Mock<() => Promise<unknown>>;
    addEventListener(type: string, listener: Listener): void;
    removeEventListener(type: string, listener: Listener): void;
  };
  reload: Mock<(...args: never[]) => unknown>;
  /** A new worker was found, finished installing and is now waiting behind the one in control. */
  newWorkerWaits(): FakeWorker;
  /** The browser tells the page a different worker is in control. */
  controllerChanges(): void;
}

export function fakeSetup(opts: { waiting?: FakeWorker | null; controlled?: boolean } = {}): FakeSetup {
  const containerListeners: Listener[] = [];
  const registrationListeners: Listener[] = [];
  const setup: FakeSetup = {
    container: {
      controller: opts.controlled === false ? null : {},
      addEventListener: (_type, listener) => void containerListeners.push(listener),
      removeEventListener: (_type, listener) => void containerListeners.splice(containerListeners.indexOf(listener), 1),
    },
    registration: {
      waiting: opts.waiting ?? null,
      installing: null,
      update: vi.fn(async () => undefined),
      addEventListener: (_type, listener) => void registrationListeners.push(listener),
      removeEventListener: (_type, listener) => void registrationListeners.splice(registrationListeners.indexOf(listener), 1),
    },
    reload: vi.fn(),
    newWorkerWaits() {
      const worker = fakeWorker('installing');
      setup.registration.installing = worker;
      for (const listener of [...registrationListeners]) listener();
      setup.registration.waiting = worker;
      setup.registration.installing = null;
      worker.become('installed');
      return worker;
    },
    controllerChanges() {
      for (const listener of [...containerListeners]) listener();
    },
  };
  return setup;
}
