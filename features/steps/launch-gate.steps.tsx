// features/steps/launch-gate.steps.tsx — runs features/launch-gate.feature (mw-4gkijo.1): the launch's cleanups,
// its error lines, a blocked or upgraded database and Loading's waiting words. The whole <App /> over the real
// Dexie store (fake-indexeddb); only the page reload is a double (a jsdom page cannot reload).
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dexie from 'dexie';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { App } from '../../src/App';
import { Loading } from '../../src/cockpit/Gate';
import { db, type MessageRow } from '../../src/data/db';
import { vaultRepo } from '../../src/data/repositories';
import { forgetTidied } from '../../src/data/tidy';
import { RELOAD_AFTER_MS, getDbTrouble, noteDbChanged, resetDbTrouble } from '../../src/data/dbTrouble';
import * as keySession from '../../src/services/keySession';
import { lock } from '../../src/services/keySession';
import { stopLive } from '../../src/services/live';
import { reloadPage } from '../../src/nav/reload';

vi.mock('../../src/nav/reload', () => ({ reloadPage: vi.fn() }));

const CIPHERTEXT = 'c2VjcmV0';

function row(txid: string, cls: MessageRow['class'], seq: number, ciphertext = `${CIPHERTEXT}${seq}`): MessageRow {
  return { id: `${txid}:0`, txid, vout: 0, seq, class: cls, to: 'phone', from: 'mayor', ts: 1_790_000_000 + seq, ciphertext, direction: 'received', read: true };
}

const DIRECT = `direct:${'ab'.repeat(32)}`;
const CHAIN = 'cd'.repeat(32);
const EVENTS = `direct:${'ef'.repeat(32)}`;

async function fresh(): Promise<void> {
  cleanup();
  stopLive();
  lock();
  vi.restoreAllMocks();
  vi.mocked(reloadPage).mockReset();
  resetDbTrouble();
  forgetTidied();
  window.history.pushState({}, '', '/?v=needs');
  if (!db.isOpen()) await db.open();
  await Promise.all([db.vault.clear(), db.settings.clear(), db.messages.clear(), db.session.clear()]);
  await vaultRepo.save({ mode: 'phrase', ciphertext: new ArrayBuffer(48), iv: new Uint8Array(12), salt: new Uint8Array(16), publicKeyHex: '02'.padEnd(66, '1') });
}

function holdThreeRows(): Promise<unknown> {
  return db.messages.bulkPut([row(DIRECT, 'message', 1, 'same'), row(CHAIN, 'message', 1, 'same'), row(EVENTS, 'events', 2)]);
}

const ids = async (): Promise<string[]> => (await db.messages.toArray()).map((r) => r.txid).sort();
const openApp = (): void => void render(<App />);
const doorIsShown = async (): Promise<void> => void (await screen.findByLabelText('Recovery phrase'));

afterAll(async () => {
  cleanup();
  stopLive();
  lock();
  resetDbTrouble();
  vi.useRealTimers();
  await db.delete();
  await db.open();
});

const feature = await loadFeature('features/launch-gate.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
  BeforeEachScenario(fresh);
  AfterEachScenario(() => {
    cleanup();
    vi.useRealTimers();
  });

  Scenario('mw-4gkijo.1 AC-2: opening the database runs no history-wide clean-up', ({ Given, When, Then }) => {
    Given('the phone holds a real message, its chain twin and a row an older build stored from an events record', holdThreeRows);
    When('the database is closed and opened again', async () => {
      db.close();
      await db.open();
    });
    Then('all three rows are still stored', async () => {
      expect(await ids()).toEqual([CHAIN, DIRECT, EVENTS].sort());
    });
  });

  Scenario('mw-4gkijo.1 AC-2: once the app is shown the clean-ups remove what they always removed', ({ Given, When, Then, And }) => {
    Given('the phone holds a real message, its chain twin and a row an older build stored from an events record', holdThreeRows);
    When('the app is opened on a phone with a key set up', openApp);
    Then('the door is shown', doorIsShown);
    And('the events row and the chain twin are removed and the direct message stays', async () => {
      await waitFor(async () => expect(await ids()).toEqual([DIRECT]));
    });
  });

  Scenario('mw-4gkijo.1 AC-3: a vault that cannot be read shows the error with Try again, not Loading', ({ Given, When, Then, And }) => {
    Given('the vault cannot be read', () => {
      vi.spyOn(vaultRepo, 'get').mockRejectedValue(new Error('The database is on fire'));
    });
    When('the app is opened on a phone with a key set up', openApp);
    Then('the screen says the vault could not be opened, with the reason', async () => {
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not open your vault.*The database is on fire/i));
      expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    });
    And('a Try again button is there, and tapping it reloads the page', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(reloadPage).toHaveBeenCalledTimes(1);
    });
  });

  Scenario("mw-4gkijo.1 AC-3: an earlier unlock that cannot be read is said on the Unlock screen's error line", ({ Given, When, Then, And }) => {
    Given('the kept session cannot be read', () => {
      vi.spyOn(keySession, 'resumeSession').mockRejectedValue(new Error('the session row is torn'));
    });
    When('the app is opened on a phone with a key set up', openApp);
    Then('the door is shown', doorIsShown);
    And("the Unlock screen's error line says the earlier unlock could not be read", async () => {
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/earlier unlock could not be read.*the session row is torn/i));
    });
  });

  Scenario('mw-4gkijo.1 AC-4: a blocked database open shows the waiting text and recovers on Try again', ({ Given, When, Then }) => {
    let older: Dexie;
    Given('another window holds an older copy of the database open', async () => {
      await db.delete({ disableAutoOpen: false });
      older = new Dexie('PosternDB');
      older.version(10).stores({
        settings: 'key',
        vault: 'id',
        messages: 'id, seq, ts, read, thread',
        snapshot: 'id',
        answers: 'bead',
        pendingSpends: 'txid',
        view: 'id',
        beadDetails: 'id, fetchedAt',
        session: 'id',
        shares: 'id, createdAt',
        events: 'seq, kind, bead, detail',
        outbox: '++id, state, bead',
      });
      // An old tab that does not let go when asked.
      older.on('versionchange', () => false);
      await older.open();
    });
    When('the app is opened on a phone with a key set up', openApp);
    Then('the screen says another Postern window is holding the database, with a Try again button', async () => {
      expect(await screen.findByText(/another postern window is holding/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
      expect(getDbTrouble()).toBe('blocked');
    });
    When('the other window lets go and Try again is tapped', async () => {
      // The old window lets go as the tap reloads: closed before the tap, the blocked open completes on its own and
      // under load the door can replace Try again before the click lands, so reloadPage is never called.
      vi.mocked(reloadPage).mockImplementation(() => {
        older.close();
        cleanup();
        openApp();
      });
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    Then('the app is on its door, no longer on Loading', async () => {
      // The blocked database was a new one (the old tab held an upgrade-less copy), so the door is the one with no key yet.
      await screen.findByRole('link', { name: 'Set up your key' }, { timeout: 10_000 });
      expect(document.querySelector('[aria-busy="true"]')).toBeNull();
      expect(reloadPage).toHaveBeenCalledTimes(1);
      expect(getDbTrouble()).toBeNull();
    });
  });

  Scenario('mw-4gkijo.1 AC-4: a database upgraded by another window is let go, said so and reloaded once', ({ Given, When, Then, And }) => {
    Given('the app is open on a phone with a key set up', async () => {
      openApp();
      await doorIsShown();
    });
    When('another window upgrades the database', async () => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('PosternDB', 990);
        open.onsuccess = () => {
          open.result.close();
          resolve();
        };
        open.onerror = () => reject(open.error);
      });
    });
    Then('the screen says Postern was updated in another window', async () => {
      expect(await screen.findByText(/updated in another window/i)).toBeInTheDocument();
      expect(db.isOpen()).toBe(false);
    });
    And('the page is reloaded once, however many times the database changes', async () => {
      await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1), { timeout: RELOAD_AFTER_MS + 3000 });
      noteDbChanged();
      await new Promise((resolve) => setTimeout(resolve, RELOAD_AFTER_MS + 300));
      expect(reloadPage).toHaveBeenCalledTimes(1);
      cleanup();
      await db.delete();
      await db.open();
    });
  });

  Scenario('mw-4gkijo.1 AC-5: Loading says what it waits on after 3 s and offers Try again after 10 s', ({ Given, When, Then }) => {
    const pass = (seconds: number) => act(async () => void vi.advanceTimersByTime(seconds * 1000));
    Given('the app is loading on a clock the test moves', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      render(<Loading />);
    });
    When('2.9 seconds have passed', () => pass(2.9));
    Then('Loading says nothing yet', () => {
      expect(screen.queryByText(/opening your vault/i)).toBeNull();
    });
    When('3 seconds have passed', () => pass(0.1));
    Then('Loading says Opening your vault', () => {
      expect(screen.getByText('Opening your vault…')).toBeInTheDocument();
    });
    When('9.9 seconds have passed', () => pass(6.9));
    Then('Loading offers no Try again yet', () => {
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    });
    When('10 seconds have passed', () => pass(0.1));
    Then('Loading offers Try again, and tapping it reloads the page', async () => {
      const button = within(document.body).getByRole('button', { name: 'Try again' });
      button.click();
      expect(reloadPage).toHaveBeenCalledTimes(1);
    });
  });
});
