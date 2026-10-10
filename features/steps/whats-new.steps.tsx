// features/steps/whats-new.steps.tsx — runs features/whats-new.feature (mw-s061bg.3): the real banner, the
// one-time sheet, the About and Me screens on bsv-kit's whats-new package, reading a fixture changelog.json.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { readFileSync } from 'node:fs';
import { startAppUpdates } from '../../src/services/appUpdate';
import { UpdateBanner } from '../../src/cockpit/UpdateBanner';
import { WhatsNewOnUpdate } from '../../src/cockpit/WhatsNew';
import { AboutScreen } from '../../src/cockpit/AboutScreen';
import { MeScreen } from '../../src/cockpit/MeScreen';
import { APP_VERSION, WHATS_NEW_STORAGE_KEY } from '../../src/services/whatsNew';
import { fakeSetup, fakeWorker } from '../../tests/support/fake-registration';
import { changelogFixture, WAITING_VERSION, stubChangelog } from '../../tests/support/changelog-fixture';

const feature = await loadFeature('features/whats-new.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
  let stop: (() => void) | undefined;

  BeforeEachScenario(() => {
    localStorage.clear();
    stubChangelog(changelogFixture());
  });
  AfterEachScenario(() => {
    stop?.();
    stop = undefined;
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });
  afterAll(() => cleanup());

  const openWithWaiting = () => {
    cleanup();
    const setup = fakeSetup({ waiting: fakeWorker() });
    stop = startAppUpdates({ container: setup.container, registration: setup.registration, reload: setup.reload }).stop;
    render(<UpdateBanner />);
  };

  const banner = () => screen.getByRole('button', { name: 'Update ready, tap to reload' });

  Scenario('AC-1: the Update ready banner names the waiting version and what is in it', ({ Given, And, Then }) => {
    Given('the changelog of the waiting build lists 2 new and 1 fixed in a version newer than the running one', () => {
      stubChangelog(changelogFixture());
    });
    And('Postern is open on a phone whose service worker has that build waiting', openWithWaiting);
    Then('the update banner shows the version with "2 new, 1 fixed" and a What\'s new button', async () => {
      expect(await screen.findByText(`${WAITING_VERSION} · 2 new, 1 fixed ·`, { exact: false })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: "What's new" })).toBeInTheDocument();
    });
    And('the Update ready, tap to reload button is still there', () => {
      expect(banner()).toBeEnabled();
    });
  });

  Scenario("AC-1: What's new on the banner opens the sheet with the waiting version's lines and a tap on Close puts it away", ({ Given, And, When, Then }) => {
    Given('the changelog of the waiting build lists 2 new and 1 fixed in a version newer than the running one', () => {
      stubChangelog(changelogFixture());
    });
    And('Postern is open on a phone whose service worker has that build waiting', openWithWaiting);
    When("he taps What's new on the banner", async () => {
      fireEvent.click(await screen.findByRole('button', { name: "What's new" }));
    });
    Then("the What's new sheet lists the waiting version's New lines before its Fixed line", () => {
      const sheet = screen.getByRole('dialog', { name: "What's new" });
      const lines = within(sheet).getAllByRole('listitem').map((li) => li.textContent);
      expect(lines).toEqual(['NewPin a message to the top.', 'NewVoice notes keep their place.', 'FixedThe list no longer jumps.']);
    });
    When('he taps Close on the sheet', () => {
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    });
    Then("the What's new sheet is gone", () => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  Scenario('AC-1: with no changelog the banner reads as it always did', ({ Given, And, Then }) => {
    Given("the waiting build's changelog cannot be read", () => {
      stubChangelog(null);
    });
    And('Postern is open on a phone whose service worker has that build waiting', openWithWaiting);
    Then("the update banner shows no What's new button", async () => {
      await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
      expect(screen.queryByRole('button', { name: "What's new" })).toBeNull();
    });
    And('the Update ready, tap to reload button is still there', () => {
      expect(banner()).toBeEnabled();
    });
  });

  Scenario("AC-1: the What's new sheet shows once after an update and not again", ({ Given, When, Then, And }) => {
    const open = () => {
      cleanup();
      render(<WhatsNewOnUpdate />);
    };
    Given('the last version he saw was older than the running one', () => {
      localStorage.setItem(WHATS_NEW_STORAGE_KEY, '0.0.1');
    });
    When('Postern opens', open);
    Then('the What\'s new sheet lists the versions since, newest first', async () => {
      const sheet = await screen.findByRole('dialog', { name: "What's new" });
      const heads = within(sheet).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
      expect(heads).toEqual([APP_VERSION, '0.0.5']);
      expect(within(sheet).queryByText('Pin a message to the top.')).toBeNull();
    });
    When('he taps Close on the sheet', () => {
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    });
    And('Postern opens again', async () => {
      expect(localStorage.getItem(WHATS_NEW_STORAGE_KEY)).toBe(APP_VERSION);
      open();
      await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
    });
    Then("there is no What's new sheet", async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  Scenario('AC-1: a first install shows no sheet and remembers the version', ({ Given, When, Then, And }) => {
    Given('he has never seen a version before', () => {
      expect(localStorage.getItem(WHATS_NEW_STORAGE_KEY)).toBeNull();
    });
    When('Postern opens', () => {
      cleanup();
      render(<WhatsNewOnUpdate />);
    });
    Then("there is no What's new sheet", async () => {
      await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    And('the running version is remembered', async () => {
      await waitFor(() => expect(localStorage.getItem(WHATS_NEW_STORAGE_KEY)).toBe(APP_VERSION));
    });
  });


  Scenario('AC-1: About has no list of versions and no Check for updates button, and links to CHANGELOG.md on GitHub beside the version', ({ When, Then, And }) => {
    When('the About screen is opened', () => {
      cleanup();
      render(<AboutScreen />);
    });
    Then('About shows the running version and the build', () => {
      const section = screen.getByRole('region', { name: 'Version' });
      expect(within(section).getByText(APP_VERSION)).toBeInTheDocument();
    });
    And('there is no Check for updates control and no list of versions', async () => {
      await waitFor(() => expect(vi.mocked(fetch)).not.toHaveBeenCalled());
      expect(screen.queryByRole('button', { name: /check for updates/i })).toBeNull();
      expect(screen.queryByText(/check for updates/i)).toBeNull();
      expect(screen.queryByRole('region', { name: "What's new" })).toBeNull();
      expect(screen.queryByRole('heading', { level: 3, name: WAITING_VERSION })).toBeNull();
      expect(screen.queryByText('The list no longer jumps.')).toBeNull();
    });
    And('a {string} link beside the version opens {string}', (_c, label: string, href: string) => {
      const section = screen.getByRole('region', { name: 'Version' });
      const link = within(section).getByRole('link', { name: label });
      expect(link.getAttribute('href')).toBe(href);
      expect(link).toHaveAttribute('target', '_blank');
    });
  });

  Scenario("AC-1: Me shows the version with a What's new on GitHub link to CHANGELOG.md", ({ When, Then, And }) => {
    When('the Me screen is opened', async () => {
      cleanup();
      render(<MeScreen />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeInTheDocument());
    });
    Then('Me shows the running version as plain text', () => {
      const build = screen.getByLabelText('Build');
      expect(within(build).getByText(APP_VERSION)).toBeInTheDocument();
      expect(within(build).queryByRole('link', { name: APP_VERSION })).toBeNull();
    });
    And('a {string} link beside the version opens {string}', (_c, label: string, href: string) => {
      const link = within(screen.getByLabelText('Build')).getByRole('link', { name: label });
      expect(link.getAttribute('href')).toBe(href);
      expect(link).toHaveAttribute('target', '_blank');
    });
  });

  Scenario("AC-1: the shipped changelog tells the first release's story", ({ Then, And }) => {
    let version = '';
    Then('public/changelog.json has "What\'s new in the app" as a New line for the version after 0.5.10', () => {
      const entries = JSON.parse(readFileSync('public/changelog.json', 'utf-8')) as { version: string; kind: string; text: string }[];
      const line = entries.find((e) => e.kind === 'new' && e.text === "What's new in the app");
      expect(line).toBeDefined();
      version = line!.version;
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(version.localeCompare('0.5.10', undefined, { numeric: true })).toBeGreaterThan(0);
    });
    And('CHANGELOG.md has a heading for that version with the same line', () => {
      const text = readFileSync('CHANGELOG.md', 'utf-8');
      expect(text).toMatch(new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b`, 'm'));
      expect(text).toContain("What's new in the app");
    });
  });
});

