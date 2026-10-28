// tests/support/push-registrations.ts — navigator.serviceWorker as a browser with per-account push registrations
// (src/push/accountScope.ts): the app's own registration at /, and a push-only one made by register() at an account's
// scope. Each holds at most one push subscription, as a real registration does.
import { vi } from 'vitest';

export interface FakeRegistration {
  scope: string;
  active: { scriptURL: string };
  pushManager: { subscribe: ReturnType<typeof vi.fn>; getSubscription: ReturnType<typeof vi.fn> };
  unregister: ReturnType<typeof vi.fn>;
  subscription: { endpoint: string; unsubscribe: ReturnType<typeof vi.fn> } | null;
}

export interface FakePushWorld {
  /** Every registration there is now, the app's own first. */
  registrations: FakeRegistration[];
  register: ReturnType<typeof vi.fn>;
}

export function installPushRegistrations(): FakePushWorld {
  const registrations: FakeRegistration[] = [];
  const make = (scope: string): FakeRegistration => {
    const registration: FakeRegistration = {
      scope,
      active: { scriptURL: 'https://postern.allmymind.org/sw.js' },
      subscription: null,
      unregister: vi.fn(async () => {
        registrations.splice(registrations.indexOf(registration), 1);
        return true;
      }),
      pushManager: {
        subscribe: vi.fn(async () => {
          const endpoint = `https://push.example/${new URL(scope).pathname}`;
          registration.subscription = {
            endpoint,
            unsubscribe: vi.fn(async () => {
              registration.subscription = null;
              return true;
            }),
          };
          return { toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }) };
        }),
        getSubscription: vi.fn(async () => registration.subscription),
      },
    };
    registrations.push(registration);
    return registration;
  };
  const main = make('https://postern.allmymind.org/');
  const register = vi.fn(async (_script: string, options: { scope: string }) => make(new URL(options.scope, 'https://postern.allmymind.org/').href));
  Object.defineProperty(navigator, 'serviceWorker', {
    value: {
      ready: Promise.resolve(main),
      register,
      getRegistration: vi.fn(async () => main),
      getRegistrations: vi.fn(async () => [...registrations]),
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, 'Notification', { value: { requestPermission: vi.fn(async () => 'granted'), permission: 'granted' }, configurable: true, writable: true });
  return { registrations, register };
}
