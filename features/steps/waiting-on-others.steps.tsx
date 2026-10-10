// features/steps/waiting-on-others.steps.tsx — runs features/waiting-on-others.feature (mw-xpy2ds):
// Needs you's Waiting on others part and the chase need, against a seeded Dexie view, no network.
import '@testing-library/react/dont-cleanup-after-each';
import { act, render, screen, cleanup, within, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { NeedsScreen } from '../../src/cockpit/NeedsScreen';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { Shell } from '../../src/cockpit/Shell';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { forgetOutboxState, settledOutbox } from '../../src/services/outbox';
import { deliverAction } from '../../src/services/deliver';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { fixtureView } from '../../tests/support/cockpit-fixture';
import type { Need } from '../../src/model/view';

vi.mock('../../src/services/deliver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/deliver')>()),
  deliverAction: vi.fn(),
}));
vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  deliverOptions: () => ({ key: new Uint8Array(32), mayorKey: '02' + '11'.repeat(32), direct: true }),
}));

configure({ asyncUtilTimeout: 5000 });

const TITLE = 'Write the permissions memo';
const BEAD = 'mw-ask.1';
const WAITING_TEXT = 'Waiting on sam (tl) since 9 Oct 12:00 UTC';
const delivered = { txid: 'direct:' + '2'.repeat(64), channel: 'direct' as const };

let now = Date.now();

function need(extra: Partial<Need>): Need {
  return { kind: 'hands', bead: '', epic: '', title: '', since: new Date(now - 3_600_000).toISOString(), text: '', recommended: '', options: [], blocks: 0, steps: [], ...extra };
}

const question = () => need({ kind: 'question', bead: 'mw-q', title: 'Which library?', options: ['A', 'B'] });
const waiting = () =>
  need({ kind: 'waiting', bead: BEAD, title: TITLE, since: new Date(now - 26 * 3_600_000).toISOString(), text: WAITING_TEXT, waits_for: 'others' });
const chase = () => need({ kind: 'chase', bead: BEAD, title: TITLE, text: `Chase sam on ${TITLE}`, waits_for: 'you' });

async function save(needs: Need[], withBead = false): Promise<void> {
  const view = fixtureView(now);
  const beads = withBead ? [{ ...view.beads[0], id: BEAD, title: TITLE, parent: '', status: 'open' }] : [];
  await viewRepo.save({ plaintext: JSON.stringify({ ...view, needs, beads }), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
}

async function fresh(): Promise<void> {
  cleanup();
  now = Date.now();
  vi.mocked(deliverAction).mockReset();
  vi.mocked(deliverAction).mockResolvedValue(delivered);
  forgetTaps();
  forgetOutboxState();
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.outbox.clear(), db.beadDetails.clear(), db.messages.clear()]);
  window.history.replaceState(null, '', '/?v=needs');
}

afterAll(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/waiting-on-others.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const opens = async () => {
    render(<NeedsScreen />);
  };
  const section = () => screen.findByRole('region', { name: 'Waiting on others' });
  const chaseCard = () => screen.findByRole('article', { name: `Chase: ${TITLE}` });
  const switchReads = async (_c: unknown, you: string, mayor: string, factory: string) => {
    const tabs = await screen.findByRole('tablist', { name: 'Who the cards wait on' });
    for (const name of [you, mayor, factory]) await waitFor(() => expect(within(tabs).getByRole('tab', { name })).toBeInTheDocument());
  };
  const chaseTapped = async (_c: unknown, name: string) => {
    await userEvent.click(within(await chaseCard()).getByRole('button', { name }));
  };
  const delivers = async (_c: unknown, action: string) => {
    await waitFor(() => expect(deliverAction).toHaveBeenCalledTimes(1));
    await act(async () => settledOutbox());
    expect(vi.mocked(deliverAction).mock.calls[0][0]).toEqual({ action, bead: BEAD });
  };
  const leaves = async () => {
    // As any answered card does, once it has gone: it leaves the queue at once, not at the host's next view.
    await waitFor(() => expect(screen.queryByRole('article', { name: `Chase: ${TITLE}` })).toBeNull());
    expect(deliverAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('tab', { name: 'You · 0' })).toBeInTheDocument();
  };
  const noSection = async () => {
    await screen.findByRole('article', { name: /Question: / });
    expect(screen.queryByRole('region', { name: 'Waiting on others' })).toBeNull();
  };

  Scenario('mw-xpy2ds: a bead waiting on others is listed under Waiting on others with who and since when, and does not count as waiting on him', ({ Given, When, Then, And }) => {
    Given('a view with a question for him and a bead waiting on others', () => save([question(), waiting()]));
    When('the Needs screen opens inside the shell', async () => {
      render(
        <Shell route={{ view: 'needs' }}>
          <NeedsScreen />
        </Shell>,
      );
    });
    Then('the Waiting on others section reads {string}', async (_c, heading: string) => {
      const found = await section();
      expect(within(found).getByText(heading)).toBeInTheDocument();
    });
    And('it lists {string} with {string} and how long ago it was asked', async (_c, title: string, words: string) => {
      const found = await section();
      const row = within(found).getByRole('listitem');
      expect(within(row).getByRole('link', { name: title })).toHaveAttribute('href', expect.stringContaining(BEAD));
      expect(within(row).getByText(words)).toBeInTheDocument();
      expect(row.querySelector('time')).not.toBeNull();
    });
    And('it offers no buttons', async () => {
      expect(within(await section()).queryAllByRole('button')).toHaveLength(0);
    });
    And('the switch reads {string}, {string} and {string}', switchReads);
    And('the Needs you tab badge reads {string}', async (_c, count: string) => {
      const tab = await screen.findByRole('link', { name: /Needs you/ });
      await waitFor(() => expect(tab.textContent).toBe(`${count}Needs you`));
    });
  });

  Scenario('mw-xpy2ds: with nothing waiting on others there is no Waiting on others section', ({ Given, When, Then }) => {
    Given('a view with a question for him and nothing waiting on others', () => save([question()]));
    When('the Needs screen opens', opens);
    Then('there is no Waiting on others section', noSection);
  });

  Scenario('mw-xpy2ds: a chase need is his, and offers Chase, Done and Keep waiting', ({ Given, When, Then, And }) => {
    Given('a view with a chase need for him', () => save([chase()]));
    When('the Needs screen opens', opens);
    Then('the chase card says {string}', async (_c, words: string) => {
      expect(within(await chaseCard()).getByText(words)).toBeInTheDocument();
    });
    And('the chase card offers {string}, {string} and {string}', async (_c, a: string, b: string, c: string) => {
      const card = await chaseCard();
      const group = within(card).getByRole('group', { name: 'Answers' });
      expect(within(group).getAllByRole('button').map((button) => button.textContent)).toEqual([a, b, c]);
    });
    And('the switch reads {string}, {string} and {string}', switchReads);
    And('there is no Waiting on others section', async () => {
      await chaseCard();
      expect(screen.queryByRole('region', { name: 'Waiting on others' })).toBeNull();
    });
  });

  Scenario('mw-xpy2ds: Chase tells the factory he chased, once, and the card leaves the queue', ({ Given, When, Then, And }) => {
    Given('a view with a chase need for him', () => save([chase()]));
    When('the Needs screen opens', opens);
    And('{string} is tapped on the chase card', chaseTapped);
    Then('one action {string} on the chase bead is delivered', delivers);
    And('the chase card leaves the queue at once', leaves);
  });

  Scenario('mw-xpy2ds: Done tells the factory the other side delivered', ({ Given, When, Then, And }) => {
    Given('a view with a chase need for him', () => save([chase()]));
    When('the Needs screen opens', opens);
    And('{string} is tapped on the chase card', chaseTapped);
    Then('one action {string} on the chase bead is delivered', delivers);
    And('the chase card leaves the queue at once', leaves);
  });

  Scenario('mw-xpy2ds: Keep waiting tells the factory to leave it for another three working days', ({ Given, When, Then, And }) => {
    Given('a view with a chase need for him', () => save([chase()]));
    When('the Needs screen opens', opens);
    And('{string} is tapped on the chase card', chaseTapped);
    Then('one action {string} on the chase bead is delivered', delivers);
    And('the chase card leaves the queue at once', leaves);
  });

  Scenario("mw-xpy2ds: a waiting need on a bead's page says who and since when, with no buttons", ({ Given, When, Then }) => {
    Given('a view with a question for him and a bead waiting on others', () => save([question(), waiting()], true));
    When("the bead's page opens", async () => {
      render(<BeadScreen id={BEAD} />);
    });
    Then('the page shows {string} and no Done button', async (_c, words: string) => {
      expect(await screen.findByText(words)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    });
  });

  Scenario("mw-xpy2ds: protocol.md's Needs-you table lists waiting and chase, and §13 lists the three answers", ({ Given, Then, And }) => {
    let doc = '';
    Given('docs/protocol.md', async () => {
      doc = readFileSync('docs/protocol.md', 'utf8');
    });
    Then('its Needs-you table lists the kinds {string} and {string}', async (_c, a: string, b: string) => {
      const start = doc.indexOf('`needs` — everything waiting on the Governor');
      const table = doc.slice(start, doc.indexOf('The table is also the kinds', start));
      expect(table).toContain(`| \`${a}\` |`);
      expect(table).toContain(`| \`${b}\` |`);
    });
    And('its actions table lists {string}, {string} and {string}', async (_c, a: string, b: string, c: string) => {
      const start = doc.indexOf('## 13. The Governor\'s actions');
      const table = doc.slice(start, doc.indexOf('## 14.', start));
      for (const action of [a, b, c]) expect(table).toContain(`| \`${action}\` |`);
    });
    And('it says the others word of waits_for is not read as you', async () => {
      expect(doc).toMatch(/`others`[^\n]*(not|never)[^\n]*`you`/);
    });
  });
});
