// src/services/jobs.ts — the by-hand jobs (docs/jobs.md): the backend reads one feed file per job that the
// factory keeps current; the app asks GET /api/jobs for the list and GET /api/jobs/{id} for one job. Nothing is
// kept on the phone: a job's progress is only worth seeing as fresh as the feed.
import { apiFetch } from './apiAuth';

export interface JobSummary {
  id: string;
  title: string;
  /** When the feed was last refreshed (RFC 3339). */
  updated: string;
  done: number;
  total: number;
}

export interface JobItem {
  label: string;
  date?: string;
  link?: string;
  /** Per check named in the job's `checks`: whether it passes. A check left out has not passed. */
  done: Record<string, boolean>;
}

export interface Job {
  id: string;
  title: string;
  updated: string;
  checks: string[];
  /** In the order to show them (newest first); the app does not sort. */
  items: JobItem[];
  /** The index of the 'you are here' item. */
  here?: number;
  note?: string;
}

export interface JobsOptions {
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

/** Whether an item has every check of the job. A job that names no checks has no item done. */
export function itemDone(job: Pick<Job, 'checks'>, item: JobItem): boolean {
  return job.checks.length > 0 && job.checks.every((check) => item.done[check] === true);
}

/** Whether a job is done: it has items and every one of them has every check. */
export function isJobDone(job: JobSummary): boolean {
  return job.total > 0 && job.done >= job.total;
}

export function openJobs(jobs: readonly JobSummary[]): JobSummary[] {
  return jobs.filter((job) => !isJobDone(job));
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function toSummary(value: unknown): JobSummary | undefined {
  if (!isRecord(value)) return undefined;
  const { id, title, updated, done, total } = value;
  if (typeof id !== 'string' || typeof title !== 'string' || typeof updated !== 'string' || typeof done !== 'number' || typeof total !== 'number') return undefined;
  return { id, title, updated, done, total };
}

/** A link opens only if it is http or https: a feed is data, never a script. */
function safeLink(value: unknown): string | undefined {
  return typeof value === 'string' && /^https?:\/\/\S+$/i.test(value) ? value : undefined;
}

function toItem(value: unknown): JobItem | undefined {
  if (!isRecord(value) || typeof value.label !== 'string') return undefined;
  const done: Record<string, boolean> = {};
  if (isRecord(value.done)) for (const [check, passed] of Object.entries(value.done)) done[check] = passed === true;
  const link = safeLink(value.link);
  return { label: value.label, ...(typeof value.date === 'string' ? { date: value.date } : {}), ...(link ? { link } : {}), done };
}

function toJob(value: unknown): Job | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string' || typeof value.updated !== 'string') return undefined;
  if (!Array.isArray(value.checks) || !Array.isArray(value.items)) return undefined;
  const checks = value.checks.filter((check): check is string => typeof check === 'string');
  const items = value.items.map(toItem).filter((item): item is JobItem => item !== undefined);
  const here = typeof value.here === 'number' && Number.isInteger(value.here) && value.here >= 0 && value.here < items.length ? value.here : undefined;
  return {
    id: value.id,
    title: value.title,
    updated: value.updated,
    checks,
    items,
    ...(here !== undefined ? { here } : {}),
    ...(typeof value.note === 'string' && value.note ? { note: value.note } : {}),
  };
}

/** The jobs the backend has, newest refreshed first; undefined when it cannot be read (down, refused, an older backend). */
export async function fetchJobs(key: Uint8Array, options: JobsOptions = {}): Promise<JobSummary[] | undefined> {
  try {
    const response = await apiFetch('/jobs', undefined, { unlockedKey: key, ...options });
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.jobs)) return undefined;
    return body.jobs.map(toSummary).filter((job): job is JobSummary => job !== undefined);
  } catch {
    return undefined;
  }
}

/** One job; 'missing' when the backend says there is none (or its feed file is bad); undefined when it cannot be read. */
export async function fetchJob(key: Uint8Array, id: string, options: JobsOptions = {}): Promise<Job | 'missing' | undefined> {
  try {
    const response = await apiFetch(`/jobs/${encodeURIComponent(id)}`, undefined, { unlockedKey: key, ...options });
    if (response.status === 404) return 'missing';
    if (!response.ok) return undefined;
    return toJob(await response.json());
  } catch {
    return undefined;
  }
}
