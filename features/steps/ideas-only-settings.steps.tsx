// features/steps/ideas-only-settings.steps.tsx — runs features/ideas-only-settings.feature
// (mw-8ifimx.3): the real Me screen against a fake backend that keeps one key's Ideas only
// setting (GET and PUT /api/ideas-only/{key}) and a Dexie, with Date frozen (timers stay real).
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, waitFor, within, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Utils } from '@bsv/sdk';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { MeScreen } from '../../src/cockpit/MeScreen';
import { setKey } from '../../src/services/keySession';
import { publicKeyHexFromMasterKey } from '../../src/services/vault';
import { db } from '../../src/data/db';
import { settingsRepo } from '../../src/data/repositories';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';
import { freezeClock, thawClock } from '../../tests/support/freeze-clock';
import type { IdeasOnlyKept, IdeasOnlySetting, IdeasOnlyState } from '../../src/model/ideasOnly';

configure({ asyncUtilTimeout: 5000 });

const HIM_KEY = new Uint8Array(Utils.toArray('45'.repeat(32), 'hex'));
const HIM = publicKeyHexFromMasterKey(HIM_KEY);
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

interface Backend {
  mode: 'up' | 'down' | 'older';
  setting: IdeasOnlySetting;
  /** a schedule window that is on until this Unix second (0: none) */
  scheduleOnUntil: number;
  puts: IdeasOnlySetting[];
}

let backend: Backend;
let nowMs = 0;

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stateOf(): IdeasOnlyState {
  const now = nowMs / 1000;
  if (backend.setting.until > now) return { on: true, until: backend.scheduleOnUntil > now ? Math.min(backend.setting.until, backend.scheduleOnUntil) : backend.setting.until, by: 'until' };
  if (backend.scheduleOnUntil > now) return { on: true, until: backend.scheduleOnUntil, by: 'schedule' };
  return { on: false, until: 0, by: '' };
}

function stubBackend(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (backend.mode === 'down') throw new TypeError('Failed to fetch');
      if (isChallengeRequest(target)) return challengeResponse();
      if (!target.endsWith(`/ideas-only/${HIM}`) || backend.mode === 'older') return new Response('404 page not found', { status: 404 });
      if (init?.method === 'PUT') {
        const sent = JSON.parse(String(init.body)) as IdeasOnlySetting;
        backend.puts.push(sent);
        backend.setting = { ...sent, reaches: sent.reaches ?? {}, updatedBy: HIM };
      }
      return json({ setting: backend.setting, state: stateOf() });
    }),
  );
}

async function open(clock: string, setup: Partial<Backend> = {}, kept?: IdeasOnlyKept): Promise<void> {
  cleanup();
  vi.unstubAllGlobals();
  thawClock();
  freezeClock(clock);
  nowMs = Date.now();
  backend = { mode: 'up', setting: { until: 0, reaches: {} }, scheduleOnUntil: 0, puts: [], ...setup };
  await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.outbox.clear()]);
  if (kept) await settingsRepo.setIdeasOnly(kept);
  setKey(HIM_KEY);
  stubBackend();
  render(<MeScreen />);
  await screen.findByRole('region', { name: 'Ideas only' });
}

const section = () => within(screen.getByRole('region', { name: 'Ideas only' }));
const secs = (iso: string): number => new Date(iso).getTime() / 1000;
const local = (y: number, mo: number, d: number, h: number, mi = 0): number => Math.floor(new Date(y, mo - 1, d, h, mi).getTime() / 1000);

async function tap(label: string): Promise<void> {
  const button = await waitFor(() => {
    const found = section().getByRole('button', { name: label });
    expect((found as HTMLButtonElement).disabled).toBe(false);
    return found;
  });
  await userEvent.click(button);
}

async function putCount(n: number): Promise<IdeasOnlySetting> {
  await waitFor(() => expect(backend.puts.length).toBe(n));
  return backend.puts[n - 1];
}

async function stateReads(text: string, how?: string): Promise<void> {
  await waitFor(() => expect(section().getByTestId('ideas-only-state').textContent).toBe(text));
  if (how) expect(section().getByText(how)).toBeTruthy();
}

const keptOnUntil21: IdeasOnlyKept = {
  key: HIM,
  setting: { until: secs('2026-10-01T21:00:00Z'), reaches: {} },
  state: { on: true, until: secs('2026-10-01T21:00:00Z'), by: 'until' },
  at: 0,
};

afterAll(() => {
  cleanup();
  thawClock();
  vi.unstubAllGlobals();
});

const feature = await loadFeature('features/ideas-only-settings.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario("mw-8ifimx.3 AC-1: Until 9 pm sets today's 21:00 in the phone's zone", ({ Given, When, Then, And }) => {
    Given('the Me screen is open at 14:00 with Ideas only off', () => open('2026-10-01T14:00:00'));
    When('"Until 9 pm" is tapped', () => tap('Until 9 pm'));
    Then("the backend was told Ideas only until today's 21:00", async () => {
      expect((await putCount(1)).until).toBe(local(2026, 10, 1, 21));
    });
    And('the State row reads "On until Thu 21:00" by the time he set', () => stateReads('On until Thu 21:00', 'by the time you set'));
  });

  Scenario("mw-8ifimx.3 AC-1: after 21:00 Until 9 pm is tomorrow's 21:00", ({ Given, When, Then, And }) => {
    Given('the Me screen is open at 22:00 with Ideas only off', () => open('2026-10-01T22:00:00'));
    When('"Until 9 pm" is tapped', () => tap('Until 9 pm'));
    Then("the backend was told Ideas only until tomorrow's 21:00", async () => {
      expect((await putCount(1)).until).toBe(local(2026, 10, 2, 21));
    });
    And('the State row reads "On until Fri 21:00" by the time he set', () => stateReads('On until Fri 21:00', 'by the time you set'));
  });

  Scenario("mw-8ifimx.3 AC-1: Until 7 am tomorrow sets tomorrow's 07:00", ({ Given, When, Then, And }) => {
    Given('the Me screen is open at 14:00 with Ideas only off', () => open('2026-10-01T14:00:00'));
    When('"Until 7 am tomorrow" is tapped', () => tap('Until 7 am tomorrow'));
    Then("the backend was told Ideas only until tomorrow's 07:00", async () => {
      expect((await putCount(1)).until).toBe(local(2026, 10, 2, 7));
    });
    And('the State row reads "On until Fri 07:00" by the time he set', () => stateReads('On until Fri 07:00', 'by the time you set'));
  });

  Scenario('mw-8ifimx.3 AC-1: For an hour sets now plus 3600 seconds', ({ Given, When, Then, And }) => {
    Given('the Me screen is open at 14:00 with Ideas only off', () => open('2026-10-01T14:00:00'));
    When('"For an hour" is tapped', () => tap('For an hour'));
    Then('the backend was told Ideas only until 15:00 today', async () => {
      expect((await putCount(1)).until).toBe(Math.floor(nowMs / 1000) + 3600);
    });
    And('the State row reads "On until Thu 15:00" by the time he set', () => stateReads('On until Thu 15:00', 'by the time you set'));
  });

  Scenario('mw-8ifimx.3 AC-1: Until... takes a date and time he picks', ({ Given, When, Then, And }) => {
    Given('the Me screen is open at 14:00 with Ideas only off', () => open('2026-10-01T14:00:00'));
    When('"Until..." is tapped, 2026-10-04T18:30 is picked and "Set" is tapped', async () => {
      await tap('Until...');
      const input = await screen.findByLabelText('Until when');
      await userEvent.type(input, '2026-10-04T18:30');
      await tap('Set');
    });
    Then("the backend was told Ideas only until 2026-10-04 18:30 in the phone's zone", async () => {
      expect((await putCount(1)).until).toBe(local(2026, 10, 4, 18, 30));
    });
    And('the State row reads "On until Sun 18:30" by the time he set', () => stateReads('On until Sun 18:30', 'by the time you set'));
  });

  Scenario('mw-8ifimx.3 AC-1: End now sets until to 0', ({ Given, When, Then, And }) => {
    Given('the Me screen is open at 14:00 with Ideas only on until 21:00', () =>
      open('2026-10-01T14:00:00', { setting: { until: secs('2026-10-01T21:00:00Z'), reaches: {} } }, keptOnUntil21),
    );
    When('"End now" is tapped', () => tap('End now'));
    Then('the backend was told Ideas only until 0', async () => {
      expect((await putCount(1)).until).toBe(0);
    });
    And('the State row reads "Off"', () => stateReads('Off'));
  });

  Scenario('mw-8ifimx.3 AC-1: End now while a schedule window is on says the schedule keeps it on', ({ Given, When, Then, And }) => {
    Given('the Me screen is open at 14:00 with Ideas only on until 21:00 and a schedule window on', () =>
      open('2026-10-01T14:00:00', { setting: { until: secs('2026-10-01T21:00:00Z'), reaches: {} }, scheduleOnUntil: secs('2026-10-01T23:00:00Z') }, keptOnUntil21),
    );
    When('"End now" is tapped', () => tap('End now'));
    Then('the backend was told Ideas only until 0', async () => {
      expect((await putCount(1)).until).toBe(0);
    });
    And('the State row reads "On until Thu 23:00" by the schedule', () => stateReads('On until Thu 23:00', 'by the schedule'));
    And('the section says the weekly schedule keeps it on', async () => {
      expect(await screen.findByText(/The weekly schedule keeps it on/)).toBeTruthy();
    });
  });

  Scenario("mw-8ifimx.3 AC-2: a weekly schedule on Sunday 09:00 to 21:00 is sent with the phone's zone", ({ Given, When, Then }) => {
    Given('the Me screen is open at 14:00 with Ideas only off', () => open('2026-10-01T14:00:00'));
    When('Sunday is ticked, From is 09:00 and To is 21:00, and "Save schedule" is tapped', async () => {
      await waitFor(() => expect((section().getByLabelText('Sun') as HTMLInputElement).disabled).toBe(false));
      await userEvent.click(section().getByLabelText('Sun'));
      await userEvent.clear(section().getByLabelText('From'));
      await userEvent.type(section().getByLabelText('From'), '09:00');
      await userEvent.clear(section().getByLabelText('To'));
      await userEvent.type(section().getByLabelText('To'), '21:00');
      await tap('Save schedule');
    });
    Then("the backend was told the schedule in the phone's zone with one window on sun from 09:00 to 21:00", async () => {
      expect((await putCount(1)).schedule).toEqual({ tz: ZONE, windows: [{ days: ['sun'], from: '09:00', to: '21:00' }] });
    });
  });

  Scenario('mw-8ifimx.3 AC-2: the two What still reaches me switches are sent', ({ Given, When, Then }) => {
    Given('the Me screen is open at 14:00 with Ideas only off', () => open('2026-10-01T14:00:00'));
    When('"The Mayor\'s ring" is switched off', async () => {
      await waitFor(() => expect((section().getByLabelText("The Mayor's ring") as HTMLInputElement).disabled).toBe(false));
      await userEvent.click(section().getByLabelText("The Mayor's ring"));
    });
    Then('the backend was told the ring does not reach him and emergencies do', async () => {
      expect((await putCount(1)).reaches).toEqual({ ring: false });
    });
    When('"Emergencies" is switched off', async () => {
      await waitFor(() => expect((section().getByLabelText('Emergencies') as HTMLInputElement).disabled).toBe(false));
      await userEvent.click(section().getByLabelText('Emergencies'));
    });
    Then('the backend was told neither the ring nor emergencies reach him', async () => {
      expect((await putCount(2)).reaches).toEqual({ ring: false, emergency: false });
    });
  });

  Scenario('mw-8ifimx.3 AC-3: with the backend unreachable the section keeps the last state and says a change could not be saved', ({ Given, When, Then, And }) => {
    Given('the Me screen is open at 14:00 with Ideas only on until 21:00 kept on the phone and the backend down', () => open('2026-10-01T14:00:00', { mode: 'down' }, keptOnUntil21));
    Then('the State row reads "On until Thu 21:00" kept from before', () => stateReads('On until Thu 21:00'));
    When('"For an hour" is tapped', () => tap('For an hour'));
    Then('the section says it could not be saved', async () => {
      expect(await screen.findByText(/Could not be saved/)).toBeTruthy();
    });
    And('the State row reads "On until Thu 21:00" kept from before', () => stateReads('On until Thu 21:00'));
  });

  Scenario('mw-8ifimx.3 AC-3: an older backend says it needs a newer backend and its controls are dead', ({ Given, Then, And }) => {
    Given('the Me screen is open at 14:00 on a backend that has no Ideas only', () => open('2026-10-01T14:00:00', { mode: 'older' }));
    Then('the section says Ideas only needs a newer backend', async () => {
      await waitFor(() => expect(section().getByTestId('ideas-only-state').textContent).toMatch(/needs a newer backend/));
    });
    And('"Until 9 pm" cannot be tapped', () => {
      expect((section().getByRole('button', { name: 'Until 9 pm' }) as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
