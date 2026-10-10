// features/steps/build-version.steps.tsx — runs features/build-version.feature under
// vitest via @amiceli/vitest-cucumber: the real Me screen and gate with the version
// vitest.config.ts defines from build-version.ts, as vite.config.ts does for a build.
import '@testing-library/react/dont-cleanup-after-each';
import { cleanup, render, screen } from '@testing-library/react';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildVersion, shortCommit } from '../../build-version';
import { MeScreen } from '../../src/cockpit/MeScreen';
import { Welcome } from '../../src/cockpit/Gate';

const VERSION_SHAPE = /^\d+\.\d+\.\d+ · \d{4}-\d{2}-\d{2} \d{2}:\d{2}Z · ([0-9a-f]{7,}|dev)$/;

const feature = await loadFeature('features/build-version.feature');

describeFeature(feature, ({ Scenario }) => {
  afterAll(() => cleanup());

  Scenario("AC-1: the Me screen's first line under its heading is Build, the build time and the commit, then the version smaller (mw-yxwtth.1)", ({ When, Then, And }) => {
    When('the Me screen is opened', () => {
      cleanup();
      render(<MeScreen />);
    });
    Then('its first line reads "Build " then the UTC build time, a dot and the short commit', async () => {
      const line = await screen.findByLabelText('Build');
      expect(line.firstElementChild?.textContent).toMatch(/^Build \d{4}-\d{2}-\d{2} \d{2}:\d{2}Z · \S+$/);
      const [, built, commit] = __APP_VERSION__.split(' · ');
      expect(__APP_VERSION__).toMatch(VERSION_SHAPE);
      expect(line.firstElementChild?.textContent).toBe(`Build ${built} · ${commit}`);
      // ...and it comes before every section of the screen.
      const keySection = screen.getByRole('region', { name: 'Key' });
      expect(line.compareDocumentPosition(keySection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
    And('the package version follows it, smaller', () => {
      const line = screen.getByLabelText('Build');
      const version = line.lastElementChild as HTMLElement;
      expect(version.firstElementChild?.textContent).toBe(__APP_VERSION__.split(' · ')[0]);
      expect(version.className).toMatch(/text-\[1[01](\.\d)?px\]/);
    });
  });

  Scenario('AC-2: the gate shows the same version', ({ When, Then }) => {
    When('the gate is opened', () => {
      cleanup();
      render(<Welcome />);
    });
    Then('it shows "v" then the same version', () => {
      expect(screen.getByText(`v${__APP_VERSION__}`)).toBeInTheDocument();
    });
  });

  Scenario('AC-3: a build outside a git checkout still has a version and names its commit dev', ({ Given, When, Then, And }) => {
    let dir = '';
    let commit = '';
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    Given('a folder that is not a git checkout', () => {
      dir = mkdtempSync(path.join(tmpdir(), 'postern-nogit-'));
    });
    When('the build asks for its short commit there', () => {
      commit = shortCommit(dir);
    });
    Then('the commit is "dev"', () => {
      expect(commit).toBe('dev');
    });
    And('the version string ends with "dev"', () => {
      expect(buildVersion('0.1.0', new Date(), commit)).toMatch(/ · dev$/);
    });
  });
});
