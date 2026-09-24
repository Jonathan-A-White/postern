// features/steps/gate.steps.tsx — Runs features/gate.feature under vitest via
// @amiceli/vitest-cucumber. Renders the same Gate component tests/unit/gate.test.tsx
// exercises directly, through testing-library, so the two suites cover the same
// behaviour from a spec-first and a unit-first angle.
//
// vitest-cucumber runs each Given/When/Then as its own vitest test(), so
// testing-library's default afterEach unmount would tear the render down between
// steps; dont-cleanup-after-each keeps the Given step's render alive for Then/And,
// and the explicit afterAll below unmounts it once the scenario finishes.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup } from '@testing-library/react';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Gate } from '../../src/gate';

const feature = await loadFeature('features/gate.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('AC-1: a visitor sees the locked gate', ({ Given, Then, And }) => {
    Given('the app is opened', () => {
      render(<Gate />);
    });

    Then('the screen shows "The gate is locked"', () => {
      expect(screen.getByText('The gate is locked')).toBeInTheDocument();
    });

    And('the app name "Postern" and the version from package.json', () => {
      expect(screen.getByText('Postern')).toBeInTheDocument();
      expect(screen.getByText(__APP_VERSION__, { exact: false })).toBeInTheDocument();
    });
  });
});

afterAll(() => {
  cleanup();
});
