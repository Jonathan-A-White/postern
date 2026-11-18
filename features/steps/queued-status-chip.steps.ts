// features/steps/queued-status-chip.steps.ts — runs features/queued-status-chip.feature (mw-ud3caof): the chip's own wording function.
import { expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { statusWord } from '../../src/cockpit/labels';

const feature = await loadFeature('features/queued-status-chip.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('mw-ud3caof AC-1: a story labelled run:queued reads Blocked on the status chip, as on the Map', ({ Given, When, Then }) => {
    let status = '';
    let labels: string[] = [];
    let word = '';
    Given('a story the tracker says is in progress, that mw has labelled run:queued', () => {
      status = 'in_progress';
      labels = ['run:queued'];
    });
    When("the bead page words its status chip", () => {
      word = statusWord(status, labels);
    });
    Then('the chip says Blocked, not In progress', () => {
      expect(word).not.toBe('In progress');
      expect(word).toBe('Blocked');
      expect(statusWord('in_progress', [])).toBe('In progress');
    });
  });
});
