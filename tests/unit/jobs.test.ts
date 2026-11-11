// tests/unit/jobs.test.ts — the Jobs feed in the app (mw-6ww.166.1, docs/jobs.md): the route, what counts as done,
// and how the answers of GET /api/jobs and GET /api/jobs/{id} are read.
import { describe, expect, it, vi } from 'vitest';
import { formatRoute, isDeep, parseRoute, topViewOf } from '../../src/nav/route';
import { fetchJob, fetchJobs, isJobDone, itemDone, openJobs, type Job } from '../../src/services/jobs';
import { challengeResponse, isChallengeRequest } from '../support/challenge-fetch';

const KEY = new Uint8Array(32).fill(7);

const reply = (routes: Record<string, Response>) =>
  vi.fn(async (url: string | URL | Request) => {
    const target = String(url);
    if (isChallengeRequest(target)) return challengeResponse();
    const hit = Object.entries(routes).find(([suffix]) => target.endsWith(suffix));
    return hit ? hit[1].clone() : new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('the jobs route', () => {
  it('round-trips the list and a job', () => {
    expect(parseRoute('?v=jobs')).toEqual({ view: 'jobs' });
    expect(parseRoute('?v=jobs&j=subsplash-links')).toEqual({ view: 'jobs', id: 'subsplash-links' });
    expect(formatRoute({ view: 'jobs' })).toBe('?v=jobs');
    expect(formatRoute({ view: 'jobs', id: 'subsplash-links' })).toBe('?v=jobs&j=subsplash-links');
  });
  it('is a step down from Home, which shows Back', () => {
    expect(isDeep({ view: 'jobs' })).toBe(true);
    expect(topViewOf({ view: 'jobs' })).toBe('needs');
  });
});

describe('what is done', () => {
  const job: Job = {
    id: 'j',
    title: 'J',
    updated: '2026-11-11T18:00:00Z',
    checks: ['mail', 'link'],
    items: [
      { label: 'a', done: { mail: true, link: true } },
      { label: 'b', done: { mail: true } },
    ],
  };
  it('is an item with every check true', () => {
    expect(itemDone(job, job.items[0])).toBe(true);
    expect(itemDone(job, job.items[1])).toBe(false);
  });
  it('is a job with items, all of them done', () => {
    expect(isJobDone({ id: 'j', title: 'J', updated: '', done: 2, total: 2 })).toBe(true);
    expect(isJobDone({ id: 'j', title: 'J', updated: '', done: 1, total: 2 })).toBe(false);
    expect(isJobDone({ id: 'j', title: 'J', updated: '', done: 0, total: 0 })).toBe(false);
  });
  it('counts the open jobs', () => {
    expect(
      openJobs([
        { id: 'a', title: 'A', updated: '', done: 2, total: 2 },
        { id: 'b', title: 'B', updated: '', done: 1, total: 2 },
      ]),
    ).toHaveLength(1);
  });
});

describe('reading the backend', () => {
  it('reads the list and keeps only well-formed rows', async () => {
    const fetchImpl = reply({
      '/jobs': json({ jobs: [{ id: 'a', title: 'A', updated: '2026-11-11T18:00:00Z', done: 1, total: 2 }, { id: 5 }, null] }),
    });
    expect(await fetchJobs(KEY, { apiBase: '/api', fetchImpl })).toEqual([{ id: 'a', title: 'A', updated: '2026-11-11T18:00:00Z', done: 1, total: 2 }]);
  });
  it('is undefined when the backend refuses, is down or answers something else', async () => {
    expect(await fetchJobs(KEY, { apiBase: '/api', fetchImpl: reply({ '/jobs': json({}, 501) }) })).toBeUndefined();
    expect(await fetchJobs(KEY, { apiBase: '/api', fetchImpl: reply({ '/jobs': json({ nope: 1 }) }) })).toBeUndefined();
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await fetchJobs(KEY, { apiBase: '/api', fetchImpl: down })).toBeUndefined();
  });
  it('reads a job, and says missing for a 404', async () => {
    const job = { id: 'a', title: 'A', updated: '2026-11-11T18:00:00Z', checks: ['mail'], items: [{ label: 'x', done: { mail: true } }], here: 0 };
    expect(await fetchJob(KEY, 'a', { apiBase: '/api', fetchImpl: reply({ '/jobs/a': json(job) }) })).toEqual(job);
    expect(await fetchJob(KEY, 'zzz', { apiBase: '/api', fetchImpl: reply({}) })).toBe('missing');
    expect(await fetchJob(KEY, 'a', { apiBase: '/api', fetchImpl: reply({ '/jobs/a': json({}, 500) }) })).toBeUndefined();
  });
  it('drops a link that is not http or https, and a here outside the items', async () => {
    const job = {
      id: 'a',
      title: 'A',
      updated: '2026-11-11T18:00:00Z',
      checks: ['mail'],
      items: [{ label: 'x', link: 'javascript:alert(1)', done: { mail: true } }],
      here: 4,
    };
    const read = await fetchJob(KEY, 'a', { apiBase: '/api', fetchImpl: reply({ '/jobs/a': json(job) }) });
    expect(read).not.toBe('missing');
    expect(read && read !== 'missing' && read.items[0].link).toBeUndefined();
    expect(read && read !== 'missing' && read.here).toBeUndefined();
  });
});

describe('the sweep (mw-6ww.166.1 AC5): no screen reads the backend state directory', () => {
  it('has no file-system read anywhere under src/, so every job and every other store reaches the app only through the API', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
      });
    const offenders = walk(join(__dirname, '../../src')).filter((file) => /from ['"](node:)?fs(\/promises)?['"]|POSTERN_DATA|\/jobs\/[a-z-]+\.json/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
