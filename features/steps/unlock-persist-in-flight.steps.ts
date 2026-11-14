// features/steps/unlock-persist-in-flight.steps.ts — runs features/unlock-persist-in-flight.feature (mw-6ww.175.60):
// the wrapping of the unlock (crypto.subtle.encrypt) is held on a promise, the real session store is fake-indexeddb,
// and "the app rebuilt" is a fresh keySession (empty memory) over the same session store.
import { expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { db } from '../../src/data/db';

const KEY = new Uint8Array([9, 8, 7, 6]);

let release: () => void;
let held: Promise<void>;
let realEncrypt: typeof crypto.subtle.encrypt;
let first: typeof import('../../src/services/keySession');
let launch: Promise<boolean> | undefined;
let answered: boolean | undefined;

async function rebuiltApp(): Promise<typeof import('../../src/services/keySession')> {
  // Fresh module memory for keySession only; the session store module (and its in-flight writes) is the same one.
  const session = await import('../../src/services/session');
  vi.resetModules();
  vi.doMock('../../src/services/session', () => session);
  return import('../../src/services/keySession');
}

const feature = await loadFeature('features/unlock-persist-in-flight.feature');

describeFeature(feature, ({ BeforeEachScenario, AfterEachScenario, Scenario }) => {
  BeforeEachScenario(async () => {
    await db.session.clear();
    launch = undefined;
    answered = undefined;
    realEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    held = new Promise<void>((resolve) => {
      release = resolve;
    });
    first = await import('../../src/services/keySession');
    first.lock();
  });

  AfterEachScenario(async () => {
    release();
    vi.restoreAllMocks();
    vi.doUnmock('../../src/services/session');
    vi.resetModules();
    await db.session.clear();
  });

  const heldWrapping = (Given: (s: string, f: () => void) => void) =>
    Given("the unlock's wrapping is held", () => {
      vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (...args: Parameters<typeof crypto.subtle.encrypt>) => {
        await held;
        return realEncrypt(...args);
      });
    });

  Scenario('mw-6ww.175.60 AC-1: the app rebuilt while the unlock is still being kept shows the door only until the write ends', ({ Given, And, When, Then }) => {
    heldWrapping(Given);
    And('he unlocks with his key', () => {
      first.setKey(KEY);
    });
    When('the app is rebuilt from the stored session', async () => {
      const rebuilt = await rebuiltApp();
      launch = rebuilt.resumeSession();
      void launch.then((v) => {
        answered = v;
      });
    });
    Then('the launch has not answered yet', async () => {
      await new Promise((r) => setTimeout(r, 50));
      expect(answered).toBeUndefined();
    });
    When('the wrapping is let go', () => {
      release();
    });
    Then('the launch finds his key and not the door', async () => {
      await expect(launch).resolves.toBe(true);
    });
  });

  Scenario('mw-6ww.175.60 AC-1b: a lock while the unlock is still being kept leaves no session behind', ({ Given, And, When, Then }) => {
    heldWrapping(Given);
    And('he unlocks with his key', () => {
      first.setKey(KEY);
    });
    When('he locks', () => {
      first.lock();
    });
    And('the wrapping is let go', async () => {
      release();
      await new Promise((r) => setTimeout(r, 50));
    });
    And('the app is rebuilt from the stored session', async () => {
      const rebuilt = await rebuiltApp();
      answered = await rebuilt.resumeSession();
    });
    Then('the launch shows the door', () => {
      expect(answered).toBe(false);
    });
  });
});
