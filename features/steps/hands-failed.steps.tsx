// features/steps/hands-failed.steps.tsx — runs features/hands-failed.feature: what a
// failed step for his hands shows (mw-t64a3.10).
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, expect } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { HandsSteps } from '../../src/cockpit/HandsSteps';
import type { HandsStep } from '../../src/model/hands';

const feature = await loadFeature('features/hands-failed.feature');

afterAll(cleanup);

function failed(ran: Partial<NonNullable<HandsStep['ran']>>): HandsStep {
  return { id: 'linger', host: 'desktop', as: 'root', run: 'loginctl enable-linger jwhite', way_back: '', sha256: 'h', ran: { at: '2026-09-29T18:52:00Z', exit: 1, host: 'desktop', ...ran } };
}

describeFeature(feature, ({ Scenario }) => {
  Scenario('mw-t64a3.10: a step that failed shows Failed and the reason, and can be run again', ({ Given, When, Then, And }) => {
    let step: HandsStep;
    Given('a step for his hands that failed with the reason "could not start: no such host"', () => {
      step = failed({ why: 'could not start: no such host' });
    });
    When('the step is shown', () => {
      cleanup();
      render(<HandsSteps bead="mw-abc.1" steps={[step]} />);
    });
    Then('the card says "Failed" and the reason "could not start: no such host"', () => {
      const card = screen.getByRole('listitem', { name: 'Step linger' });
      expect(within(card).getByText('Failed')).toBeInTheDocument();
      expect(within(card).getByText('could not start: no such host')).toBeInTheDocument();
    });
    And('the card still offers "Approve and run again"', () => {
      const card = screen.getByRole('listitem', { name: 'Step linger' });
      expect(within(card).getByRole('button', { name: 'Approve and run again' })).toBeInTheDocument();
    });
  });

  Scenario('mw-t64a3.10: a failed step with no reason reads as before', ({ Given, When, Then }) => {
    let step: HandsStep;
    Given('a step for his hands that failed with exit 2 and no reason', () => {
      step = failed({ exit: 2 });
    });
    When('the step is shown', () => {
      cleanup();
      render(<HandsSteps bead="mw-abc.1" steps={[step]} />);
    });
    Then('the card says "failed, exit 2" and not "Failed"', () => {
      const card = screen.getByRole('listitem', { name: 'Step linger' });
      expect(within(card).getByText('failed, exit 2')).toBeInTheDocument();
      expect(within(card).queryByText('Failed')).toBeNull();
    });
  });
});
