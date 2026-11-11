// features/steps/jobs.steps.tsx — runs features/jobs.feature (mw-6ww.166.1): Home's Jobs chip, the Jobs page
// and a job's page against a stubbed GET /api/jobs and GET /api/jobs/{id}, with a stand-in for App's routing.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Utils } from '@bsv/sdk';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { NeedsScreen } from '../../src/cockpit/NeedsScreen';
import { JobsScreen } from '../../src/cockpit/JobsScreen';
import { useRoute } from '../../src/router';
import { setKey, lock } from '../../src/services/keySession';
import { db } from '../../src/data/db';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';
import type { Job } from '../../src/services/jobs';

const HIM_KEY = new Uint8Array(Utils.toArray('46'.repeat(32), 'hex'));
const CHECKS = ['mail', 'link', 'live'];

/** A feed of n sermons, newest first ("Sermon 1" is the newest). The first `done` have every check; the rest have
 * the mail only. 'You are here' is the first sermon that is not done. */
function feed(id: string, title: string, sermons: number, done: number, minutesAgo: number): Job {
  return {
    id,
    title,
    updated: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    checks: CHECKS,
    items: Array.from({ length: sermons }, (_, i) => ({
      label: `Sermon ${i + 1}`,
      date: `2026-11-${String(Math.max(1, 28 - i)).padStart(2, '0')}`,
      done: i < done ? { mail: true, link: true, live: true } : { mail: true },
    })),
    ...(done < sermons ? { here: done } : {}),
  };
}

const summaryOf = (job: Job) => ({
  id: job.id,
  title: job.title,
  updated: job.updated,
  done: job.items.filter((item) => CHECKS.every((c) => item.done[c])).length,
  total: job.items.length,
});

let feeds: Job[] = [];
let down = false;
let asked: string[] = [];
let feedArrivedAt = 0;

function stubBackend(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (isChallengeRequest(target)) return challengeResponse();
      if (down) throw new TypeError('Failed to fetch');
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      const one = /\/jobs\/([^/?]+)$/.exec(target);
      if (one) {
        asked.push(`jobs/${one[1]}`);
        const found = feeds.find((job) => job.id === one[1]);
        if (found) feedArrivedAt = performance.now();
        return found ? json(found) : json({ error: 'no such job' }, 404);
      }
      if (target.endsWith('/jobs')) {
        asked.push('jobs');
        return json({ jobs: feeds.map(summaryOf) });
      }
      return new Response('{}', { status: 404 });
    }),
  );
}

async function fresh(): Promise<void> {
  cleanup();
  vi.unstubAllGlobals();
  feeds = [];
  down = false;
  asked = [];
  await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.outbox.clear()]);
  setKey(HIM_KEY);
  window.history.replaceState(null, '', '/?v=needs');
  stubBackend();
}

// A stand-in for App's routing.
// eslint-disable-next-line react-refresh/only-export-components
function Harness() {
  const route = useRoute();
  if (route.view === 'jobs') return <JobsScreen id={route.id} />;
  return <NeedsScreen />;
}

const scrolled: Element[] = [];

afterAll(() => {
  cleanup();
  lock();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/jobs.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    await fresh();
    scrolled.length = 0;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
  });

  const hasJob = (_c: unknown, id: string, title: string, sermons: number, done: number, minutes: number) => {
    feeds.push(feed(id, title, sermons, done, minutes));
  };
  const openJobsPage = () => {
    window.history.replaceState(null, '', '/?v=jobs');
    render(<Harness />);
  };
  const jobRow = async (title: string) => within(await screen.findByRole('link', { name: new RegExp(`^${title}`) }));
  const itemRow = async (label: string) => within(await screen.findByTestId(`job-item-${label}`));
  const pageSays = async (_c: unknown, words: string) => {
    expect(await screen.findByText(new RegExp(words))).toBeInTheDocument();
  };
  const listed = async (_c: unknown, title: string) => {
    expect(await screen.findByRole('link', { name: new RegExp(`^${title}`) })).toBeInTheDocument();
  };
  const tryAgain = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
  };

  Scenario("mw-6ww.166.1 AC2: Home shows a Jobs chip with the count of open jobs", ({ Given, And, When, Then }) => {
    Given('the backend has the job {string} titled {string} with {int} sermons, {int} done on every check, updated {int} minutes ago', hasJob);
    And('the backend has the job {string} titled {string} with {int} sermons, {int} done on every check, updated {int} minutes ago', hasJob);
    When('Home opens', () => {
      render(<Harness />);
    });
    Then('the Jobs chip says {string}', async (_c, words: string) => {
      await screen.findByRole('link', { name: /^Jobs/ });
      await waitFor(() => {
        const chip = screen.getByRole('link', { name: /^Jobs/ });
        expect(chip).toHaveTextContent(words);
        expect(chip).toHaveAttribute('href', '?v=jobs');
      });
    });
  });

  Scenario('mw-6ww.166.1 AC2: Home shows no Jobs chip while there is no job', ({ Given, When, Then, And }) => {
    Given('the backend has no jobs', () => {
      feeds = [];
    });
    When('Home opens', () => {
      render(<Harness />);
    });
    Then('the backend was asked for the jobs', async () => {
      await waitFor(() => expect(asked).toContain('jobs'));
    });
    And('Home shows no Jobs chip', async () => {
      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByRole('link', { name: /^Jobs/ })).not.toBeInTheDocument();
    });
  });

  Scenario('mw-6ww.166.1 AC2: the Jobs page lists a job with its title, N of M done and when it was updated', ({ Given, When, Then, And }) => {
    Given('the backend has the job {string} titled {string} with {int} sermons, {int} done on every check, updated {int} minutes ago', hasJob);
    When('the Jobs page opens', openJobsPage);
    Then('the job {string} says {string}', async (_c, title: string, words: string) => {
      expect((await jobRow(title)).getByText(words)).toBeInTheDocument();
    });
    And('the job {string} says {string}', async (_c, title: string, words: string) => {
      expect((await jobRow(title)).getByText(words)).toBeInTheDocument();
    });
  });

  Scenario("mw-6ww.166.1 AC2: a job's page lists its items in the feed's order with a mark per check, and marks and scrolls to where you are", ({ Given, When, Then, And }) => {
    Given('the backend has the job {string} titled {string} with {int} sermons, {int} done on every check, updated {int} minutes ago', hasJob);
    When('the page of the job {string} opens', (_c, id: string) => {
      window.history.replaceState(null, '', `/?v=jobs&j=${id}`);
      render(<Harness />);
    });
    Then('the items are listed in the order {string}', async (_c, order: string) => {
      await screen.findByTestId('job-item-Sermon 1');
      const labels = screen.getAllByTestId(/^job-item-/).map((row) => row.getAttribute('data-testid')?.replace('job-item-', ''));
      expect(labels.join(', ')).toBe(order);
    });
    And('the item {string} has all three checks ticked', async (_c, label: string) => {
      const row = await itemRow(label);
      for (const check of CHECKS) expect(row.getByLabelText(`${check}: done`)).toBeInTheDocument();
    });
    And('the item {string} has its checks {string} and {string} not yet done', async (_c, label: string, a: string, b: string) => {
      const row = await itemRow(label);
      expect(row.getByLabelText(`${a}: done`)).toBeInTheDocument();
      expect(row.getByLabelText(`${b}: not yet`)).toBeInTheDocument();
    });
    And('the item {string} is marked {string} and was scrolled to', async (_c, label: string, mark: string) => {
      const row = await itemRow(label);
      expect(row.getByText(mark)).toBeInTheDocument();
      await waitFor(() => expect(scrolled).toContain(screen.getByTestId(`job-item-${label}`)));
      expect(screen.getAllByText(mark)).toHaveLength(1);
    });
    And('the page says {string}', pageSays);
  });

  Scenario('mw-6ww.166.1 AC3: a job whose items are all done shows Done and sits under the Done fold', ({ Given, And, When, Then }) => {
    Given('the backend has the job {string} titled {string} with {int} sermons, {int} done on every check, updated {int} minutes ago', hasJob);
    And('the backend has the job {string} titled {string} with {int} sermons, {int} done on every check, updated {int} minutes ago', hasJob);
    When('the Jobs page opens', openJobsPage);
    Then('the job {string} is listed', listed);
    And('the job {string} is not listed', async (_c, title: string) => {
      await screen.findByRole('button', { name: /^Done/ });
      expect(screen.queryByRole('link', { name: new RegExp(`^${title}`) })).not.toBeInTheDocument();
    });
    When('the Done fold is opened', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Done/ }));
    });
    Then('the job {string} is now listed', listed);
    When('the job {string} is opened', async (_c, title: string) => {
      await userEvent.click(await screen.findByRole('link', { name: new RegExp(`^${title}`) }));
    });
    Then('the page says {string}', async (_c, words: string) => {
      await screen.findByTestId('job-item-Sermon 1');
      expect(screen.getByText(words, { selector: '[data-testid="job-done"]' })).toBeInTheDocument();
    });
  });

  Scenario("mw-6ww.166.1 AC4: a job of 354 items draws every row within the test's budget", ({ Given, When, Then }) => {
    Given('the backend has the job {string} titled {string} with {int} sermons, {int} done on every check, updated {int} minutes ago', hasJob);
    When('the page of the job {string} opens', (_c, id: string) => {
      window.history.replaceState(null, '', `/?v=jobs&j=${id}`);
      render(<Harness />);
    });
    Then('all {int} items are drawn within {int} ms of the feed arriving', async (_c, count: number, budget: number) => {
      await waitFor(() => expect(screen.getAllByTestId(/^job-item-/)).toHaveLength(count), { timeout: budget * 3 });
      expect(performance.now() - feedArrivedAt).toBeLessThan(budget);
    });
  });

  Scenario('mw-6ww.166.1 AC2: the Jobs page says so when the backend cannot be read, and Try again asks again', ({ Given, When, Then, And }) => {
    Given('the backend is down', () => {
      down = true;
    });
    When('the Jobs page opens', openJobsPage);
    Then('the page says {string}', pageSays);
    When('the backend comes back with the job {string} titled {string} with {int} sermons, {int} done on every check, updated {int} minutes ago', (_c, id: string, title: string, s: number, d: number, m: number) => {
      down = false;
      hasJob(_c, id, title, s, d, m);
    });
    And('Try again is tapped', tryAgain);
    Then('the job {string} is listed', listed);
  });
});
