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

  Scenario('AC-1: the Me screen\'s last line is Postern v, the version, the build time and the commit', ({ When, Then }) => {
    When('the Me screen is opened', () => {
      cleanup();
      render(<MeScreen />);
    });
    Then('its last line reads "Postern v" then the version, the UTC build time and the short commit', async () => {
      const line = await screen.findByText(`Postern v${__APP_VERSION__}`);
      expect(line.textContent).toMatch(/^Postern v\d+\.\d+\.\d+ · \d{4}-\d{2}-\d{2} \d{2}:\d{2}Z · \S+$/);
      expect(__APP_VERSION__).toMatch(VERSION_SHAPE);
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
