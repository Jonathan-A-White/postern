// features/steps/roadmap.steps.tsx — runs features/roadmap.feature (mw-njb33n.3): the Roadmap's lanes by app.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Roadmap, RoadmapScreen } from '../../src/cockpit/RoadmapScreen';
import { LANE_COLOURS, pictureModel } from '../../src/cockpit/roadmapPicture';
import { indexView } from '../../src/model/tree';
import type { ViewBead } from '../../src/model/view';
import { fixtureView } from '../../tests/support/cockpit-fixture';

afterAll(() => {
  cleanup();
});

const feature = await loadFeature('features/roadmap.feature');

// RoadmapScreen reads the live view from here; a scenario sets what it holds.
let liveBeads: ViewBead[] = [];
vi.mock('../../src/cockpit/hooks', async (orig) => {
  const real = await orig<typeof import('../../src/cockpit/hooks')>();
  return { ...real, useViewIndex: () => ({ index: indexView({ ...fixtureView(), needs: [], beads: liveBeads }) }) };
});

// A GL that records and draws nothing, for a phone that has WebGL.
function fakeGl(): RenderingContext {
  return new Proxy(
    {},
    {
      get: (_t, key) => {
        if (typeof key !== 'string') return undefined;
        if (/^[A-Z][A-Z0-9_]*$/.test(key)) return 1;
        return () => ({});
      },
    },
  ) as unknown as RenderingContext;
}

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  let beads: ViewBead[];

  BeforeEachScenario(() => {
    cleanup();
    vi.restoreAllMocks();
    beads = [];
  });

  const template = fixtureView().beads[0];
  const story = (id: string, rig: string, priority: number, extra: Partial<ViewBead> = {}): ViewBead => ({
    ...template,
    id,
    title: `${rig} story ${id}`,
    type: 'task',
    status: 'open',
    priority,
    parent: undefined,
    labels: [],
    waits: [],
    closed: '',
    path: { rig, branch: 'main', host: 'laptop', model: 'sonnet', effort: 'high', formula: 'tdd-feature', harness: 'claude' },
    ...extra,
  });

  Scenario('mw-njb33n.3 AC1: the lanes count the work by app and a tap opens an app to its titles', ({ Given, When, Then, And }) => {
    Given('a view with open work across two apps at several priorities', () => {
      beads = [
        story('l.1', 'lampas', 0),
        story('l.2', 'lampas', 1),
        story('p.1', 'postern', 1),
        story('p.2', 'postern', 2),
        story('l.3', 'lampas', 3),
        story('p.3', 'postern', 4, { labels: ['icebox'], status: 'deferred' }),
      ];
    });
    When('the Roadmap is drawn', () => {
      render(<Roadmap index={indexView({ ...fixtureView(), needs: [], beads })} />);
    });
    Then('the Now lane counts {int} and shows one row for {string} with its top title', (_c, count: number, app: string) => {
      const now = screen.getByRole('region', { name: 'Now' });
      expect(within(now).getByTestId('lane-count')).toHaveTextContent(String(count));
      expect(within(now).getByRole('button', { name: new RegExp(`^${app}, 2`) })).toHaveTextContent('lampas story l.1');
    });
    And('the Next, Later and Icebox lanes count {int}, {int} and {int}', (_c, next: number, later: number, icebox: number) => {
      for (const [lane, n] of [['Next', next], ['Later', later], ['Icebox', icebox]] as const) {
        expect(within(screen.getByRole('region', { name: lane })).getByTestId('lane-count')).toHaveTextContent(String(n));
      }
    });
    When('he taps the {string} row in Now', (_c, app: string) => {
      fireEvent.click(within(screen.getByRole('region', { name: 'Now' })).getByRole('button', { name: new RegExp(`^${app}, 2`) }));
    });
    Then('its titles show, each a link to its bead', () => {
      const now = screen.getByRole('region', { name: 'Now' });
      expect(within(now).getByRole('link', { name: /lampas story l\.2/ }).getAttribute('href')).toContain('l.2');
      expect(within(now).getByRole('link', { name: /lampas story l\.1/ }).getAttribute('href')).toContain('l.1');
    });
  });

  const epicView = () => {
    const epic = (id: string, rig: string) => story(id, rig, 2, { type: 'epic', title: `${rig} epic ${id}` });
    return [
      epic('big', 'lampas'),
      story('big.1', 'lampas', 0, { parent: 'big' }),
      story('big.2', 'lampas', 2, { parent: 'big' }),
      epic('small', 'postern'),
      story('small.1', 'postern', 3, { parent: 'small' }),
    ];
  };

  Scenario("mw-njb33n.6 AC1: the Picture shows each epic as a node, sized by open work and coloured by lane", ({ Given, When, Then }) => {
    Given('a view with epics holding open stories in several lanes', () => {
      liveBeads = epicView();
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeGl());
    });
    When("the Roadmap's Picture is opened", () => {
      render(<RoadmapScreen />);
      fireEvent.click(screen.getByRole('tab', { name: 'Picture' }));
    });
    Then('there is a node per epic, the epic with more open stories is bigger, and each is coloured by its lane', () => {
      expect(screen.getByTestId('roadmap-picture')).toBeInTheDocument();
      const model = pictureModel(indexView({ ...fixtureView(), needs: [], beads: liveBeads }));
      const big = model.nodes.find((n) => n.id === 'big')!;
      const small = model.nodes.find((n) => n.id === 'small')!;
      expect(model.nodes).toHaveLength(2);
      expect(big.r).toBeGreaterThan(small.r);
      expect(big.colour).toEqual(LANE_COLOURS.now);
      expect(small.colour).toEqual(LANE_COLOURS.later);
    });
  });

  Scenario('mw-njb33n.6 AC3: without WebGL the Picture gives way to the lanes', ({ Given, When, Then }) => {
    Given('a phone that has no WebGL', () => {
      liveBeads = epicView();
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    });
    When("the Roadmap's Picture is opened", () => {
      render(<RoadmapScreen />);
      fireEvent.click(screen.getByRole('tab', { name: 'Picture' }));
    });
    Then('the lanes show and the Picture says it is not available', () => {
      expect(screen.getByTestId('roadmap')).toBeInTheDocument();
      expect(screen.queryByTestId('roadmap-picture')).toBeNull();
      expect(screen.getByRole('status')).toHaveTextContent(/WebGL/);
    });
  });
});
