// features/steps/iced-beads.steps.tsx — runs features/iced-beads.feature (mw-njb33n.1):
// iced beads read Iced, an epic folds them into one Icebox (n) row, and the bead page offers Thaw.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { MapScreen } from '../../src/cockpit/MapScreen';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { statusWord } from '../../src/cockpit/labels';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { forgetOutboxState } from '../../src/services/outbox';
import { settlePhone } from '../../tests/support/empty-phone';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { deliverAction } from '../../src/services/deliver';
import { fixtureView } from '../../tests/support/cockpit-fixture';
import type { ViewBead } from '../../src/model/view';

vi.mock('../../src/services/deliver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/deliver')>()),
  deliverAction: vi.fn(async () => ({ txid: 'direct:' + '1'.repeat(64), channel: 'direct' as const })),
}));
vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  deliverOptions: () => ({ key: new Uint8Array(32), mayorKey: '02' + '11'.repeat(32), direct: true }),
}));

let now = Date.now();
let beads: ViewBead[] = [];

function beadIn(id: string, extra: Partial<ViewBead>): ViewBead {
  const template = fixtureView(now).beads[0];
  return { ...template, id, title: `Title of ${id}`, type: 'task', status: 'open', parent: undefined, labels: [], waits: [], done_earlier: 0, closed: '', ...extra };
}

async function save(): Promise<void> {
  const written = new Date(now - 60_000).toISOString();
  await viewRepo.save({ plaintext: JSON.stringify({ ...fixtureView(now), needs: [], beads, written_at: written }), written_at: written, source: 'live', fetchedAt: now });
}

async function fresh(): Promise<void> {
  cleanup();
  forgetTaps();
  await settlePhone();
  forgetOutboxState();
  vi.mocked(deliverAction).mockClear();
  now = Date.now();
  beads = [];
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear(), db.outbox.clear()]);
  window.history.replaceState(null, '', '/?v=map');
}

const EPIC = 'mw-e';
const title = (id: string) => `Title of ${id}`;
const path = { rig: 'postern', branch: 'main', host: 'laptop', model: 'sonnet', effort: 'high', formula: 'tdd-feature' };

afterAll(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/iced-beads.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const epicWithIced = () => {
    beads.push(beadIn(EPIC, { type: 'epic', status: 'open' }));
    beads.push(beadIn(`${EPIC}.1`, { parent: EPIC }));
    beads.push(beadIn(`${EPIC}.2`, { parent: EPIC, status: 'deferred', priority: 4, labels: ['icebox'] }));
    beads.push(beadIn(`${EPIC}.3`, { parent: EPIC, status: 'deferred', priority: 4, labels: ['icebox'] }));
  };
  const closedIcebox = async () => {
    expect(await screen.findByRole('button', { name: 'Icebox (2)', expanded: false })).toBeInTheDocument();
  };
  const notListed = () => {
    expect(screen.queryByText(title(`${EPIC}.2`))).not.toBeInTheDocument();
    expect(screen.queryByText(title(`${EPIC}.3`))).not.toBeInTheDocument();
  };

  Scenario('mw-njb33n.1 AC1: an iced bead reads Iced whatever its status', ({ Given, Then, And }) => {
    Given('a deferred bead labelled icebox and an open bead labelled icebox', () => undefined);
    Then('both read {string}', (_c, word: string) => {
      expect(statusWord('deferred', ['icebox'])).toBe(word);
      expect(statusWord('open', ['icebox'])).toBe(word);
    });
    And('a deferred bead without the icebox label reads {string}', (_c, word: string) => {
      expect(statusWord('deferred', [])).toBe(word);
    });
  });

  Scenario('mw-njb33n.1 AC1: an epic with two iced stories shows one Icebox (2) row, closed, that opens on a tap', ({ Given, When, Then, And }) => {
    Given('an epic with one live story and two iced stories', epicWithIced);
    When('the epic opens on the Map', async () => {
      await save();
      render(<MapScreen focus={EPIC} lens="board" />);
    });
    Then('a button {string} is shown, closed', closedIcebox);
    And('the iced stories are not listed', async () => {
      await screen.findByText(title(`${EPIC}.1`));
      notListed();
    });
    When('the {string} button is tapped', async (_c, name: string) => {
      await userEvent.click(await screen.findByRole('button', { name }));
    });
    Then('the Icebox lists both iced stories', async () => {
      const section = await screen.findByRole('region', { name: 'Icebox' });
      await waitFor(() => expect(within(section).getByText(title(`${EPIC}.2`))).toBeInTheDocument());
      expect(within(section).getByText(title(`${EPIC}.3`))).toBeInTheDocument();
    });
    And('the live story is still on the board', () => {
      expect(within(screen.getByTestId('board')).getByText(title(`${EPIC}.1`))).toBeInTheDocument();
    });
  });

  Scenario("mw-njb33n.1 AC1: an epic's Release counts the held stories, not the iced ones", ({ Given, When, Then }) => {
    Given('an epic with one live story and two iced stories', epicWithIced);
    When('the epic opens on the Map', async () => {
      await save();
      render(<MapScreen focus={EPIC} lens="board" />);
    });
    Then('no Release button is offered on the Map', async () => {
      await screen.findByRole('button', { name: 'Icebox (2)' });
      expect(screen.queryByRole('button', { name: /^Release/ })).toBeNull();
    });
  });

  Scenario('mw-njb33n.1 AC1: the List view folds the iced stories the same way', ({ Given, When, Then, And }) => {
    Given('an epic with one live story and two iced stories', epicWithIced);
    When('the epic opens on the Map as a list', async () => {
      await save();
      render(<MapScreen focus={EPIC} lens="list" />);
    });
    Then('a button {string} is shown, closed', closedIcebox);
    And('the iced stories are not listed', async () => {
      await within(await screen.findByTestId('bead-list')).findByText(title(`${EPIC}.1`));
      notListed();
    });
  });

  Scenario("mw-njb33n.1 AC1: an iced story's page offers Thaw, and a tap sends the thaw", ({ Given, Then, When, And }) => {
    Given('the bead page of an iced story', async () => {
      beads.push(beadIn('mw-s', { status: 'deferred', priority: 4, labels: ['icebox'], path }));
      await save();
      render(<BeadScreen id="mw-s" />);
    });
    Then('the page offers the button {string}', async (_c, name: string) => {
      await waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled());
    });
    And('the page says {string}', (_c, word: string) => {
      expect(screen.getByText(word, { selector: 'span' })).toBeInTheDocument();
    });
    When('he taps {string}', async (_c, name: string) => {
      await userEvent.click(await screen.findByRole('button', { name }));
    });
    Then('the thaw for the story is sent', async () => {
      await waitFor(() => expect(deliverAction).toHaveBeenCalledWith({ action: 'thaw', bead: 'mw-s' }, expect.anything()));
    });
    And('the page no longer offers Thaw', async () => {
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Thaw' })).toBeNull());
    });
  });

  Scenario('mw-njb33n.1 AC1: a story that is not iced has no Thaw', ({ Given, Then }) => {
    Given('the bead page of a story that is not iced', async () => {
      beads.push(beadIn('mw-s', { status: 'deferred', path }));
      await save();
      render(<BeadScreen id="mw-s" />);
    });
    Then('the page has no Thaw button', async () => {
      await screen.findByLabelText('Actions');
      await screen.findByText('Priority');
      expect(screen.queryByRole('button', { name: 'Thaw' })).toBeNull();
    });
  });
});
