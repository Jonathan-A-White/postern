// features/steps/map-not-yet.steps.tsx — runs features/map-not-yet.feature
// (mw-t64a3.28): the Map focused on an epic the stored view lacks, against a
// seeded Dexie view and a faked per-bead fetch. The fake saves the detail the way
// the real fetchBeadDetail does, so the screen reads it back from Dexie.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, waitFor, configure } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { MapScreen } from '../../src/cockpit/MapScreen';
import { db } from '../../src/data/db';
import { beadDetailsRepo, viewRepo } from '../../src/data/repositories';
import { fixtureView } from '../../tests/support/cockpit-fixture';
import { setKey, lock } from '../../src/services/keySession';
import { fetchBeadDetail } from '../../src/services/beads';
import { refreshNow } from '../../src/services/live';
import type { ViewBead } from '../../src/model/view';

vi.mock('../../src/services/beads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/beads')>()),
  fetchBeadDetail: vi.fn(),
}));
vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  refreshNow: vi.fn(async () => undefined),
}));

configure({ asyncUtilTimeout: 5000 });

let now = Date.now();

function epicIn(id: string): ViewBead {
  const template = fixtureView(now).beads[0];
  return { ...template, id, title: `Title of ${id}`, type: 'epic', status: 'open', parent: undefined, labels: [], waits: [], done_earlier: 0, closed: '' };
}

async function saveView(beads: ViewBead[]): Promise<void> {
  await viewRepo.save({ plaintext: JSON.stringify({ ...fixtureView(now), needs: [], beads }), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
}

async function fresh(): Promise<void> {
  cleanup();
  now = Date.now();
  vi.mocked(fetchBeadDetail).mockReset();
  vi.mocked(refreshNow).mockClear();
  await Promise.all([db.settings.clear(), db.view.clear(), db.beadDetails.clear()]);
  setKey(new Uint8Array(32));
  window.history.replaceState(null, '', '/?v=map');
}

function backendSays(id: string, status: string): void {
  vi.mocked(fetchBeadDetail).mockImplementation(async () => {
    const detail = { v: 2, id, title: `Title of ${id}`, type: 'epic', status, priority: 2, comments: [] };
    await beadDetailsRepo.save({ id, plaintext: JSON.stringify(detail), fetchedAt: Date.now() });
    return { status: 'ok', detail: detail as never };
  });
}

afterAll(() => {
  cleanup();
  lock();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/map-not-yet.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const viewLacks = async () => {
    await saveView([]);
  };
  const backendOpen = (_c: unknown, id: string) => backendSays(id, 'open');
  const backendClosed = (_c: unknown, id: string) => backendSays(id, 'closed');
  const backendFails = () => {
    vi.mocked(fetchBeadDetail).mockRejectedValue(new Error('The backend answered 500.'));
  };
  const mapOpened = (_c: unknown, id: string) => {
    render(<MapScreen focus={id} />);
  };
  const says = async (_c: unknown, text: string) => {
    expect(await screen.findByText(text)).toBeInTheDocument();
  };
  const notAsked = () => {
    expect(refreshNow).not.toHaveBeenCalled();
  };
  const mayHaveClosed = async (_c: unknown, id: string) => {
    expect(await screen.findByText(new RegExp(`${id} is not among the live epics \\(it may have closed more than a week ago\\)`))).toBeInTheDocument();
  };

  Scenario('mw-t64a3.28: an open epic missing from the view is "Not on the map yet" and the view is refreshed once', ({ Given, And, When, Then }) => {
    Given('the phone\'s view does not hold the epic {string}', viewLacks);
    And('the backend says {string} is open', backendOpen);
    When('the Map is opened focused on {string}', mapOpened);
    Then('the Map says {string}', says);
    And('it says {string} is open but the map on this phone is older than it', async (_c, id: string) => {
      expect(await screen.findByText(new RegExp(`${id} is open, but the map on this phone is older than it\\. It will appear when the view refreshes\\.`))).toBeInTheDocument();
    });
    And('an {string} link is shown', async (_c, name: string) => {
      expect(await screen.findByRole('link', { name })).toHaveAttribute('href', expect.stringContaining('mw-fresh'));
    });
    And('the view was asked to refresh once', async () => {
      await waitFor(() => expect(refreshNow).toHaveBeenCalledTimes(1));
    });
  });

  Scenario('mw-t64a3.28: the epic shows focused, with no second tap, once a later view holds it', ({ Given, And, When, Then }) => {
    Given('the phone\'s view does not hold the epic {string}', viewLacks);
    And('the backend says {string} is open', backendOpen);
    When('the Map is opened focused on {string}', mapOpened);
    Then('the Map says {string}', says);
    When('a later view arrives holding the epic {string}', async (_c, id: string) => {
      await saveView([epicIn(id)]);
    });
    Then('the Map shows the epic {string} focused', async (_c, id: string) => {
      expect(await screen.findByRole('heading', { name: `Title of ${id}` })).toBeInTheDocument();
      expect(screen.getByLabelText('Work')).toBeInTheDocument();
    });
    And('{string} is gone', (_c, text: string) => {
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    });
  });

  Scenario('mw-t64a3.28: an epic the backend says is closed keeps the "Not in the live view" text', ({ Given, And, Then, When }) => {
    Given('the phone\'s view does not hold the epic {string}', viewLacks);
    And('the backend says {string} is closed', backendClosed);
    When('the Map is opened focused on {string}', mapOpened);
    Then('the Map says {string}', says);
    And('it says {string} may have closed more than a week ago', mayHaveClosed);
    And('the view was not asked to refresh', notAsked);
  });

  Scenario('mw-t64a3.28: an epic the backend cannot be asked about keeps the "Not in the live view" text', ({ Given, And, Then, When }) => {
    Given('the phone\'s view does not hold the epic {string}', viewLacks);
    And('the backend cannot be asked about {string}', backendFails);
    When('the Map is opened focused on {string}', mapOpened);
    Then('the Map says {string}', says);
    And('it says {string} may have closed more than a week ago', mayHaveClosed);
    And('the view was not asked to refresh', notAsked);
  });
});
