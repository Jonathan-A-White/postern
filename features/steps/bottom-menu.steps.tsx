// features/steps/bottom-menu.steps.tsx — runs features/bottom-menu.feature (mw-tbx1n.12):
// the Shell around a bead's page and a thread, against a seeded Dexie view, with
// window.matchMedia answering as a 390 px phone or a wide screen.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { Shell } from '../../src/cockpit/Shell';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { fixtureView } from '../../tests/support/cockpit-fixture';

configure({ asyncUtilTimeout: 5000 });

const BEAD = 'mw-f758y.30.4';

function screenIs(widthPx: number): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string) => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      return { matches: min ? widthPx >= Number(min[1]) : false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined };
    },
  );
}

async function seedView(): Promise<void> {
  const now = Date.now();
  await viewRepo.save({ plaintext: JSON.stringify(fixtureView(now)), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
}

async function fresh(): Promise<void> {
  cleanup();
  vi.unstubAllGlobals();
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.messages.clear(), db.beadDetails.clear()]);
}

afterAll(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

const places = ['Needs you', 'Map', 'Channels', 'Search', 'Me'];

const menu = () => screen.getByRole('navigation', { name: 'Places' });

const feature = await loadFeature('features/bottom-menu.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const phone = async () => {
    screenIs(390);
    await seedView();
  };
  const wideScreen = async () => {
    screenIs(1280);
    await seedView();
  };
  const beadOpens = async () => {
    window.history.replaceState(null, '', `/?v=bead&id=${BEAD}`);
    render(
      <Shell route={{ view: 'bead', id: BEAD }}>
        <BeadScreen id={BEAD} />
      </Shell>,
    );
  };
  const threadOpens = async () => {
    window.history.replaceState(null, '', '/?v=talk&thread=general');
    render(
      <Shell route={{ view: 'talk', thread: 'general' }}>
        <TalkScreen thread="general" />
      </Shell>,
    );
  };
  const offersFive = async () => {
    const nav = await screen.findByRole('navigation', { name: 'Places' });
    const labels = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent?.replace(/^\d+/, ''));
    expect(labels).toEqual(places);
  };
  const isCurrent = async (_c: unknown, label: string) => {
    const nav = await screen.findByRole('navigation', { name: 'Places' });
    expect(within(nav).getByRole('link', { current: 'page' })).toHaveTextContent(label);
  };
  const composerAboveMenu = async () => {
    const composer = await screen.findByTestId('composer');
    const nav = menu();
    expect(composer.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(composer.className).not.toContain('pb-safe');
    expect(nav.className).toContain('pb-safe');
  };
  const backStays = async () => {
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument());
  };

  Scenario("mw-tbx1n.12: a bead's page on a phone still has the five places along the bottom, under its composer", ({ Given, When, Then, And }) => {
    Given('a phone 390 px wide and a view with a bead', phone);
    When("the bead's page opens inside the shell", beadOpens);
    Then('the bottom menu offers {string}, {string}, {string}, {string} and {string}', offersFive);
    And('{string} is the place marked as current', isCurrent);
    And('the composer sits above the bottom menu and only the menu keeps the bottom safe-area inset', composerAboveMenu);
    And('the header still offers Back', backStays);
  });

  Scenario('mw-tbx1n.12: a thread on a phone still has the five places along the bottom, under its composer', ({ Given, When, Then, And }) => {
    Given('a phone 390 px wide and a view with a bead', phone);
    When('a thread opens inside the shell', threadOpens);
    Then('the bottom menu offers {string}, {string}, {string}, {string} and {string}', offersFive);
    And('{string} is the place marked as current', isCurrent);
    And('the composer sits above the bottom menu and only the menu keeps the bottom safe-area inset', composerAboveMenu);
    And('the header still offers Back', backStays);
  });

  Scenario('mw-tbx1n.12: on a wide screen the composer keeps the safe-area inset and there is no bottom menu', ({ Given, When, Then, And }) => {
    Given('a wide screen and a view with a bead', wideScreen);
    When('a thread opens inside the shell', threadOpens);
    Then('there is no bottom menu', async () => {
      await screen.findByTestId('composer');
      // On a wide screen the Places nav is the sidebar, not a bottom bar.
      expect(screen.getByText("The Governor's cockpit")).toBeInTheDocument();
      expect(menu().className).not.toContain('pb-safe');
    });
    And('the composer keeps the bottom safe-area inset', async () => {
      expect((await screen.findByTestId('composer')).className).toContain('pb-safe');
    });
  });
});
