// src/cockpit/useJobs.ts — the by-hand jobs for a screen (src/services/jobs.ts): one ask of the backend on open and
// whenever the phone comes back to the foreground, so a page left open shows the factory's latest sweep.
import { useEffect, useState } from 'react';
import { fetchJob, fetchJobs, type Job, type JobSummary } from '../services/jobs';
import { useUnlockedKey } from './hooks';

export interface JobListState {
  /** undefined until the first answer. */
  jobs: JobSummary[] | undefined;
  /** True when the last ask got no answer (the list, if any, is the earlier one). */
  failed: boolean;
  retry: () => void;
}

export function useJobList(): JobListState {
  const key = useUnlockedKey();
  const [jobs, setJobs] = useState<JobSummary[] | undefined>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!key) return;
    let current = true;
    const ask = () => {
      void fetchJobs(key).then((answer) => {
        if (!current) return;
        setFailed(answer === undefined);
        if (answer !== undefined) setJobs(answer);
      });
    };
    ask();
    const onVisible = () => {
      if (document.visibilityState === 'visible') ask();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      current = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key, attempt]);
  return { jobs, failed, retry: () => setAttempt((n) => n + 1) };
}

export interface JobState {
  /** undefined until the first answer; 'missing' when the backend has no such job. */
  job: Job | 'missing' | undefined;
  failed: boolean;
  retry: () => void;
}

/** One job. Keyed by the screen on its id, so another job starts from nothing. */
export function useJob(id: string): JobState {
  const key = useUnlockedKey();
  const [job, setJob] = useState<Job | 'missing' | undefined>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!key) return;
    let current = true;
    const ask = () => {
      void fetchJob(key, id).then((answer) => {
        if (!current) return;
        setFailed(answer === undefined);
        if (answer !== undefined) setJob(answer);
      });
    };
    ask();
    const onVisible = () => {
      if (document.visibilityState === 'visible') ask();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      current = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key, id, attempt]);
  return { job, failed, retry: () => setAttempt((n) => n + 1) };
}
