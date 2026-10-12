// src/model/ideasOnly.ts — Ideas only (docs/protocol.md §25) as the phone reads it: the setting and
// state the backend keeps per key, and the pure time sums behind the presets. The phone works the
// times out in its own zone; the backend only ever sees Unix seconds.

export const WEEK_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

export const DAY_LABELS: Record<WeekDay, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

export interface IdeasOnlyWindow {
  days: WeekDay[];
  from: string;
  to: string;
}

export interface IdeasOnlySchedule {
  tz: string;
  windows: IdeasOnlyWindow[];
}

/** What stays pushed while the mode is on; an absent value is on. */
export interface IdeasOnlyReaches {
  ring?: boolean;
  emergency?: boolean;
}

export interface IdeasOnlySetting {
  /** Unix seconds; 0 is none. */
  until: number;
  schedule?: IdeasOnlySchedule;
  reaches: IdeasOnlyReaches;
  updatedAt?: string;
  updatedBy?: string;
}

/** The state the backend works out from the setting: `until` is the nearer end, 0 when off. */
export interface IdeasOnlyState {
  on: boolean;
  until: number;
  by: 'until' | 'schedule' | '';
}

/** The last answer the phone kept (settings table, key 'ideasOnly'), for the key that asked. */
export interface IdeasOnlyKept {
  key: string;
  setting: IdeasOnlySetting;
  state: IdeasOnlyState;
  /** When the phone last heard (ms). */
  at: number;
}

export const EMPTY_SETTING: IdeasOnlySetting = { until: 0, reaches: {} };

/** Whether a ring still reaches him while the mode is on. */
export const ringReaches = (setting: IdeasOnlySetting): boolean => setting.reaches.ring !== false;
/** Whether an emergency still reaches him while the mode is on. */
export const emergencyReaches = (setting: IdeasOnlySetting): boolean => setting.reaches.emergency !== false;

const pad = (n: number): string => String(n).padStart(2, '0');

/** Unix seconds of the next `hour`:00 local, today's if it is still ahead of `nowMs`, else tomorrow's. */
export function untilHourLocal(hour: number, nowMs: number): number {
  const at = new Date(nowMs);
  at.setHours(hour, 0, 0, 0);
  if (at.getTime() <= nowMs) at.setDate(at.getDate() + 1);
  return Math.floor(at.getTime() / 1000);
}

/** 'Until 9 pm': today 21:00 local, or tomorrow's once that has passed. */
export const untilNinePm = (nowMs: number): number => untilHourLocal(21, nowMs);

/** 'Until 7 am tomorrow': tomorrow's 07:00 local. */
export function untilSevenTomorrow(nowMs: number): number {
  const at = new Date(nowMs);
  at.setDate(at.getDate() + 1);
  at.setHours(7, 0, 0, 0);
  return Math.floor(at.getTime() / 1000);
}

/** 'For an hour': now + 3600 s. */
export const forAnHour = (nowMs: number): number => Math.floor(nowMs / 1000) + 3600;

/** A datetime-local value ('2026-10-04T21:00', in the phone's zone) as Unix seconds, or undefined when it is no time. */
export function untilFromLocal(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
}

/** 'Sun 21:00': a Unix second as the weekday and 24-hour time in the phone's zone. */
export function describeUntil(until: number): string {
  const at = new Date(until * 1000);
  return `${at.toLocaleDateString('en-US', { weekday: 'short' })} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** The end as he reads it: '21:00' when it is today, else 'Fri 07:00'. */
export function untilClock(until: number, nowMs: number): string {
  const at = new Date(until * 1000);
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  return at.toDateString() === new Date(nowMs).toDateString() ? clock : `${at.toLocaleDateString('en-US', { weekday: 'short' })} ${clock}`;
}

/** What stands under everything he sends while the mode is on, and in place of 'waiting' on a tap. */
export const recordedWords = (until: number, nowMs: number): string => `Recorded for after ${untilClock(until, nowMs)}`;

/** The end of the mode as of `nowMs`, in Unix seconds; undefined when it is off (or its end has passed). */
export function onUntil(kept: IdeasOnlyKept | undefined, nowMs: number): number | undefined {
  if (!kept) return undefined;
  const state = stateAt(kept.state, nowMs);
  return state.on ? state.until : undefined;
}

/** The state as of `nowMs`: a kept 'on' whose end has passed is off until the backend says otherwise. */
export function stateAt(state: IdeasOnlyState, nowMs: number): IdeasOnlyState {
  return state.on && state.until * 1000 <= nowMs ? { on: false, until: 0, by: '' } : state;
}

/** Reads an answer's `{setting, state}` into the shapes above; undefined when it is not one. */
export function readAnswer(body: unknown): { setting: IdeasOnlySetting; state: IdeasOnlyState } | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const { setting, state } = body as { setting?: unknown; state?: unknown };
  if (typeof setting !== 'object' || setting === null || typeof state !== 'object' || state === null) return undefined;
  const s = setting as Partial<IdeasOnlySetting>;
  const st = state as Partial<IdeasOnlyState>;
  if (typeof st.on !== 'boolean') return undefined;
  const reaches = typeof s.reaches === 'object' && s.reaches !== null ? s.reaches : {};
  return {
    setting: {
      until: typeof s.until === 'number' ? s.until : 0,
      ...(s.schedule && Array.isArray(s.schedule.windows) && typeof s.schedule.tz === 'string' ? { schedule: s.schedule } : {}),
      reaches,
      updatedAt: s.updatedAt,
      updatedBy: s.updatedBy,
    },
    state: { on: st.on, until: typeof st.until === 'number' ? st.until : 0, by: st.by === 'until' || st.by === 'schedule' ? st.by : '' },
  };
}

export type Preset = 'nine' | 'seven' | 'hour';

/** The `until` a preset button sets, worked out from the phone's clock. */
export function presetUntil(preset: Preset, nowMs: number = Date.now()): number {
  return preset === 'nine' ? untilNinePm(nowMs) : preset === 'seven' ? untilSevenTomorrow(nowMs) : forAnHour(nowMs);
}

/** `nowMs` as Unix seconds. */
export const nowSeconds = (nowMs: number = Date.now()): number => Math.floor(nowMs / 1000);

/** The one from/to pair the section edits, as drafted. */
export interface ScheduleDraft {
  days: WeekDay[];
  from: string;
  to: string;
}

export const DEFAULT_DRAFT: ScheduleDraft = { days: [], from: '09:00', to: '21:00' };

/** The draft the kept schedule's first window gives (the section edits that one), else the default. */
export function draftOf(setting: IdeasOnlySetting | undefined): ScheduleDraft {
  const first = setting?.schedule?.windows[0];
  return first ? { days: WEEK_DAYS.filter((day) => first.days.includes(day)), from: first.from, to: first.to } : DEFAULT_DRAFT;
}

/** Whether the draft can be saved: a day, and a window that does not end where it starts. */
export const draftProblem = (draft: ScheduleDraft): string | undefined =>
  draft.days.length === 0 ? 'Pick at least one day.' : !draft.from || !draft.to ? 'Set a time for From and To.' : draft.from === draft.to ? 'From and To must differ.' : undefined;

/** The phone's own time zone, sent with a schedule. */
export const phoneZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The setting with the draft as the first window of its schedule (other windows kept as they are). */
export function withSchedule(setting: IdeasOnlySetting, draft: ScheduleDraft, tz: string = phoneZone()): IdeasOnlySetting {
  const others = setting.schedule?.windows.slice(1) ?? [];
  return { ...setting, schedule: { tz, windows: [{ days: [...draft.days], from: draft.from, to: draft.to }, ...others] } };
}

/** The setting with no schedule. */
export function withoutSchedule(setting: IdeasOnlySetting): IdeasOnlySetting {
  const rest = { ...setting };
  delete rest.schedule;
  return rest;
}
