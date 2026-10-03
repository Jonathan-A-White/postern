// features/steps/still-dot.steps.tsx — runs features/still-dot.feature (mw-1ox07o.2):
// a 60 fps animation on every screen cost the phone its battery; the dots now stay
// still, so nothing in these two places carries an animation class.
import '@testing-library/react/dont-cleanup-after-each';
import { cleanup, render, screen } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { LiveBadge } from '../../src/cockpit/Shell';
import { BeadCard } from '../../src/cockpit/BeadCards';
import { indexView } from '../../src/model/tree';
import { fixtureView } from '../../tests/support/cockpit-fixture';

vi.mock('../../src/services/live', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/services/live')>();
  return { ...real, useLive: () => ({ ...real.getLiveState(), status: 'live' as const }) };
});

const feature = await loadFeature('features/still-dot.feature');

/** Every element under `root` whose class names an animation (animate-live, animate-pulse…). */
function animated(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[class*="animate-"]'));
}

describeFeature(feature, ({ Scenario, AfterAllScenarios }) => {
  AfterAllScenarios(() => cleanup());
  afterAll(() => cleanup());

  Scenario('AC-1: the live dot in the header does not pulse while the factory is live', ({ Given, When, Then }) => {
    Given('the factory is live', () => {
      cleanup();
    });
    When("the header's live badge is shown", () => {
      render(<LiveBadge />);
    });
    Then('its dot does not animate', () => {
      const badge = screen.getByTestId('live-badge');
      expect(badge.querySelector('[aria-hidden="true"]')).not.toBeNull();
      expect(animated(badge)).toHaveLength(0);
    });
  });

  Scenario('AC-2: the dot on a working bead card does not pulse', ({ Given, When, Then }) => {
    const index = indexView(fixtureView());
    const working = index.view.beads.find((b) => b.status === 'in_progress' && b.type !== 'epic');
    Given('a bead that is in progress', () => {
      cleanup();
      expect(working).toBeDefined();
    });
    When('its card is shown', () => {
      render(<BeadCard bead={working!} index={index} />);
    });
    Then("the card's dot does not animate", () => {
      const card = screen.getByTestId('bead-card');
      expect(card.querySelector('[aria-hidden="true"]')).not.toBeNull();
      expect(animated(card)).toHaveLength(0);
    });
  });
});
