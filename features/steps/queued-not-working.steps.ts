// features/steps/queued-not-working.steps.ts — runs features/queued-not-working.feature (mw-8a6vysw): the real tree model over the cockpit fixture.
import { expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { bucketOf, epicStats, factoryStats, indexView, type ViewIndex } from '../../src/model/tree';
import { fixtureView } from '../../tests/support/cockpit-fixture';

const NOW = Date.parse('2026-09-28T12:00:00Z');
const STORY = 'mw-f758y.30.2';

const feature = await loadFeature('features/queued-not-working.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('mw-8a6vysw AC-1: a story labelled run:queued leaves the Working column, the epic\'s count and the factory\'s figure', ({ Given, When, Then }) => {
    let before: ViewIndex;
    let after: ViewIndex;
    Given('a story the tracker says is in progress, that mw has labelled run:queued', () => {
      before = indexView(fixtureView(NOW));
      const view = fixtureView(NOW);
      view.beads = view.beads.map((bead) => (bead.id === STORY ? { ...bead, status: 'in_progress', labels: [...bead.labels, 'run:queued'] } : bead));
      after = indexView(view);
    });
    When('the map sorts the work into its columns', () => {
      expect(bucketOf(before.byId.get(STORY)!, before)).toBe('working');
    });
    Then('the story is not in Working, and the epic and the factory count one story fewer working', () => {
      expect(bucketOf(after.byId.get(STORY)!, after)).not.toBe('working');
      expect(epicStats('mw-f758y', after).counts.working).toBe(epicStats('mw-f758y', before).counts.working - 1);
      expect(factoryStats(after, new Date(NOW)).working).toBe(factoryStats(before, new Date(NOW)).working - 1);
    });
  });
});
