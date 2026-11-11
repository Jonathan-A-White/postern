// src/cockpit/JobsScreen.tsx — Jobs (mw-6ww.166.1, docs/jobs.md): the progress of the Governor's by-hand jobs, read from a
// feed the factory keeps current. The list shows each open job (title, N of M done, when it was refreshed) and
// folds the finished ones under Done; a job's page lists its items in the feed's order with a tick or a dot per
// check, marks the 'you are here' row and scrolls to it. Home carries a Jobs chip while any job exists.
import { useLayoutEffect, useRef, useState } from 'react';
import { Banner, Button, EmptyState, Icon, Spinner, cx } from '../ui';
import { useNow } from '../ui/useNow';
import { Screen } from './Shell';
import { useJob, useJobList } from './useJobs';
import { formatRoute } from '../nav/route';
import { relativeTime } from '../services/age';
import { isJobDone, itemDone, openJobs, type Job, type JobItem, type JobSummary } from '../services/jobs';

/** 'Updated 5 min ago', a minute-by-minute reading of the feed's own refresh time. */
function Updated({ at, className }: { at: string; className?: string }) {
  const now = useNow(30_000);
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return (
    <time dateTime={date.toISOString()} title={date.toLocaleString()} className={className}>
      Updated {relativeTime(date, new Date(now))}
    </time>
  );
}

const CHIP_CLASS =
  'flex h-11 w-full items-center gap-2.5 rounded-2xl border border-line bg-surface px-4 text-[14.5px] font-semibold text-muted hover:bg-raised';

/** The way in to the Jobs page, shown on Home while any job exists, with how many are still open. */
export function JobsChip({ className }: { className?: string }) {
  const { jobs } = useJobList();
  if (!jobs || jobs.length === 0) return null;
  return (
    <a href={formatRoute({ view: 'jobs' })} className={cx(CHIP_CLASS, className)}>
      <Icon name="list" size={18} />
      Jobs · {openJobs(jobs).length} open
      <Icon name="forward" size={14} className="ml-auto" />
    </a>
  );
}

function JobRow({ job }: { job: JobSummary }) {
  const done = isJobDone(job);
  return (
    <li>
      <a href={formatRoute({ view: 'jobs', id: job.id })} className="flex min-h-11 items-center gap-3 px-4 py-3 hover:bg-raised">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[14.5px] font-semibold">{job.title}</span>
          <span className="text-[13px] text-muted tabular-nums">{done ? 'Done' : `${job.done} of ${job.total} done`}</span>
          <Updated at={job.updated} className="text-[12px] text-faint" />
        </span>
        <Icon name="forward" size={15} className="shrink-0 text-muted" />
      </a>
    </li>
  );
}

function JobList() {
  const { jobs, failed, retry } = useJobList();
  const [showDone, setShowDone] = useState(false);
  if (jobs === undefined && !failed) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-muted" role="status">
        <Spinner /> Reading the jobs…
      </p>
    );
  }
  if (jobs === undefined) {
    return (
      <EmptyState icon="alarm" title="The jobs could not be read">
        <p>The backend did not answer. Check the connection, then try again.</p>
        <Button size="sm" icon="refresh" className="mt-3" onClick={retry}>
          Try again
        </Button>
      </EmptyState>
    );
  }
  const open = openJobs(jobs);
  const finished = jobs.filter(isJobDone);
  return (
    <div className="flex flex-col gap-4">
      {failed && (
        <Banner tone="blocked" icon="alarm" action={<Button size="sm" variant="ghost" onClick={retry}>Try again</Button>}>
          Could not refresh; this is what was read earlier.
        </Banner>
      )}
      {jobs.length === 0 ? (
        <EmptyState icon="check" title="No jobs yet">
          A job appears here once the factory keeps a feed for it.
        </EmptyState>
      ) : open.length === 0 ? (
        <p className="px-1 text-[13px] text-muted">Nothing is open.</p>
      ) : (
        <ul aria-label="Open jobs" className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {open.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </ul>
      )}
      {finished.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Done jobs">
          <button
            type="button"
            aria-expanded={showDone}
            onClick={() => setShowDone((was) => !was)}
            className="flex h-11 items-center gap-2 px-1 text-left text-[12.5px] font-semibold text-muted"
          >
            Done · {finished.length}
            <Icon name={showDone ? 'down' : 'forward'} size={14} />
          </button>
          {showDone && (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {finished.map((job) => (
                <JobRow key={job.id} job={job} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

const CHECK_COL = '3.5rem';

function Mark({ check, passed }: { check: string; passed: boolean }) {
  return (
    <span
      role="img"
      aria-label={`${check}: ${passed ? 'done' : 'not yet'}`}
      className={cx('flex items-center justify-center', passed ? 'text-done' : 'text-faint')}
      style={{ width: CHECK_COL }}
    >
      {passed ? <Icon name="check" size={16} strokeWidth={2.4} /> : <span className="size-1.5 rounded-full bg-current" />}
    </span>
  );
}

function ItemRow({ job, item, here }: { job: Job; item: JobItem; here: boolean }) {
  const ref = useRef<HTMLLIElement>(null);
  useLayoutEffect(() => {
    if (here) ref.current?.scrollIntoView?.({ block: 'center' });
  }, [here]);
  return (
    <li
      ref={ref}
      data-testid={`job-item-${item.label}`}
      aria-current={here ? 'true' : undefined}
      className={cx('flex items-center gap-1 px-4 py-2.5', here && 'bg-raised shadow-[inset_3px_0_0_var(--color-accent)]')}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {item.link ? (
          <a href={item.link} target="_blank" rel="noopener noreferrer" className="wrap-anywhere text-[14px] font-medium underline-offset-2 hover:underline">
            {item.label}
          </a>
        ) : (
          <span className="wrap-anywhere text-[14px] font-medium">{item.label}</span>
        )}
        <span className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
          {item.date && <span>{item.date}</span>}
          {here && <span className="font-semibold text-accent">You are here</span>}
        </span>
      </span>
      {job.checks.map((check) => (
        <Mark key={check} check={check} passed={item.done[check] === true} />
      ))}
    </li>
  );
}

function JobPage({ id }: { id: string }) {
  const { job, failed, retry } = useJob(id);
  const back = { view: 'jobs' } as const;
  if (job === undefined && !failed) {
    return (
      <Screen title="Job" back={back}>
        <p className="flex items-center gap-2 text-[13px] text-muted" role="status">
          <Spinner /> Reading the job…
        </p>
      </Screen>
    );
  }
  if (job === undefined || job === 'missing') {
    return (
      <Screen title="Job" back={back}>
        <EmptyState icon="alarm" title={job === 'missing' ? 'That job is not there' : 'The job could not be read'}>
          {job === 'missing' ? (
            <p>The backend has no feed for it (or its file is not valid).</p>
          ) : (
            <>
              <p>The backend did not answer. Check the connection, then try again.</p>
              <Button size="sm" icon="refresh" className="mt-3" onClick={retry}>
                Try again
              </Button>
            </>
          )}
        </EmptyState>
      </Screen>
    );
  }
  const doneCount = job.items.filter((item) => itemDone(job, item)).length;
  const finished = job.items.length > 0 && doneCount === job.items.length;
  return (
    <Screen title={job.title} subtitle={finished ? undefined : `${doneCount} of ${job.items.length} done`} back={back}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
          {finished && (
            <span data-testid="job-done" className="font-semibold text-done">
              Done
            </span>
          )}
          <Updated at={job.updated} />
        </div>
        {failed && (
          <Banner tone="blocked" icon="alarm" action={<Button size="sm" variant="ghost" onClick={retry}>Try again</Button>}>
            Could not refresh; this is what was read earlier.
          </Banner>
        )}
        {job.note && <p className="text-[13.5px] wrap-anywhere">{job.note}</p>}
        {job.items.length === 0 ? (
          <EmptyState icon="check" title="No items yet" />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <div aria-hidden="true" className="flex items-center gap-1 border-b border-line px-4 py-1.5 text-[11px] font-semibold text-faint">
              <span className="flex-1">Items, newest first</span>
              {job.checks.map((check) => (
                <span key={check} className="truncate text-center" style={{ width: CHECK_COL }}>
                  {check}
                </span>
              ))}
            </div>
            <ul className="divide-y divide-line">
              {job.items.map((item, index) => (
                <ItemRow key={index} job={job} item={item} here={job.here === index} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </Screen>
  );
}

/** The Jobs page, or one job's page when `id` names it. */
export function JobsScreen({ id }: { id?: string }) {
  if (id) return <JobPage key={id} id={id} />;
  return (
    <Screen title="Jobs" subtitle="Work you do by hand, and how far it has got" back={{ view: 'needs' }}>
      <JobList />
    </Screen>
  );
}
