// src/cockpit/IdeasOnlySection.tsx — Settings > Ideas only: whether the mode is on and until when,
// the presets that turn it on, End now, a weekly schedule and what still reaches him while it is on.
// The backend keeps it per key (src/services/ideasOnly.ts); every control says what a tap does and
// goes dead, saying Saving…, while a change is on its way.
import { useState } from 'react';
import { Button, Card, SectionTitle, useAlive } from '../ui';
import { useNow } from '../ui/useNow';
import {
  DAY_LABELS,
  WEEK_DAYS,
  describeUntil,
  draftOf,
  draftProblem,
  emergencyReaches,
  nowSeconds,
  phoneZone,
  presetUntil,
  ringReaches,
  stateAt,
  untilFromLocal,
  withSchedule,
  withoutSchedule,
  type Preset,
  type ScheduleDraft,
  type WeekDay,
} from '../model/ideasOnly';
import { baseSetting } from '../services/ideasOnly';
import { Row } from './MeRow';
import { useUnlockedKey } from './hooks';
import { useIdeasOnly } from './useIdeasOnly';

const PRESETS: { preset: Preset; label: string }[] = [
  { preset: 'nine', label: 'Until 9 pm' },
  { preset: 'seven', label: 'Until 7 am tomorrow' },
  { preset: 'hour', label: 'For an hour' },
];

const switchClass = 'inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[13px]';
const inputClass = 'h-8 rounded-lg border border-line bg-transparent px-2 text-[13px]';

export function IdeasOnlySection() {
  const key = useUnlockedKey();
  const { kept, availability, saving, saveError, save } = useIdeasOnly();
  const now = useNow(30_000);
  const [picking, setPicking] = useState(false);
  const [pickedValue, setPickedValue] = useState('');
  const [pickedProblem, setPickedProblem] = useState<string>();
  const [edit, setEdit] = useState<ScheduleDraft | null>(null);
  const alive = useAlive();

  const setting = baseSetting(kept);
  const state = kept ? stateAt(kept.state, now) : undefined;
  const older = availability === 'older';
  const dead = !key || saving || older;
  const draft = edit ?? draftOf(kept?.setting);
  const problem = draftProblem(draft);
  const untilSet = setting.until * 1000 > now;
  const hasSchedule = !!setting.schedule?.windows.length;

  const stateText = older ? 'Ideas only needs a newer backend' : !state ? (availability === 'checking' ? 'Checking…' : 'Not known yet') : state.on ? `On until ${describeUntil(state.until)}` : 'Off';
  const how = !older && state?.on ? (state.by === 'schedule' ? 'by the schedule' : state.by === 'until' ? 'by the time you set' : '') : '';

  async function setUntil(until: number) {
    if ((await save({ ...setting, until })) && alive()) {
      setPicking(false);
      setPickedValue('');
    }
  }

  function pickUntil() {
    const until = untilFromLocal(pickedValue);
    if (until === undefined) return setPickedProblem('Pick a date and a time.');
    if (until <= nowSeconds()) return setPickedProblem('That time has already passed.');
    setPickedProblem(undefined);
    void setUntil(until);
  }

  function toggleDay(day: WeekDay, on: boolean) {
    const days = on ? WEEK_DAYS.filter((d) => d === day || draft.days.includes(d)) : draft.days.filter((d) => d !== day);
    setEdit({ ...draft, days });
  }

  return (
    <section className="flex flex-col gap-2" aria-label="Ideas only">
      <SectionTitle>Ideas only</SectionTitle>
      <Card className="divide-y divide-line">
        <Row label="State">
          <span className="flex flex-col items-end">
            <span data-testid="ideas-only-state">{stateText}</span>
            {how && <span className="text-[12.5px] text-muted">{how}</span>}
          </span>
        </Row>
        {!older && kept && availability === 'offline' && <p className="px-4 py-3 text-[13px] text-muted">The backend could not be reached; this is the last state this phone kept.</p>}
        {!older && state?.on && state.by === 'schedule' && !untilSet && <p className="px-4 py-3 text-[13px] text-muted">The weekly schedule keeps it on. Turn the schedule off below to end it.</p>}
        {saving && (
          <p role="status" className="px-4 py-3 text-[13px] text-muted">
            Saving…
          </p>
        )}
        {saveError && (
          <p role="alert" className="px-4 py-3 text-[13px] text-danger">
            {saveError}
          </p>
        )}

        <div className="flex flex-col gap-2 px-4 py-3">
          <span className="text-[14px] font-medium">Start now, until</span>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map(({ preset, label }) => (
              <Button key={preset} size="sm" disabled={dead} onClick={() => void setUntil(presetUntil(preset))}>
                {label}
              </Button>
            ))}
            <Button size="sm" disabled={dead} onClick={() => setPicking((open) => !open)}>
              Until...
            </Button>
          </div>
          {picking && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-[13px]">
                Until when
                <input type="datetime-local" className={inputClass} value={pickedValue} disabled={dead} onChange={(event) => setPickedValue(event.target.value)} />
              </label>
              <Button size="sm" variant="primary" disabled={dead || !pickedValue} onClick={pickUntil}>
                Set
              </Button>
              {pickedProblem && <span className="text-[13px] text-danger">{pickedProblem}</span>}
            </div>
          )}
          {untilSet && (
            <div>
              <Button size="sm" variant="ghost" disabled={dead} onClick={() => void setUntil(0)}>
                End now
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 px-4 py-3" data-testid="ideas-only-schedule">
          <span className="text-[14px] font-medium">Every week</span>
          <div className="flex flex-wrap gap-2">
            {WEEK_DAYS.map((day) => (
              <label key={day} className={switchClass}>
                <input type="checkbox" className="h-4 w-4 accent-[var(--pc-accent)]" checked={draft.days.includes(day)} disabled={dead} onChange={(event) => toggleDay(day, event.target.checked)} />
                {DAY_LABELS[day]}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5 text-[13px]">
              From
              <input type="time" className={inputClass} value={draft.from} disabled={dead} onChange={(event) => setEdit({ ...draft, from: event.target.value })} />
            </label>
            <label className="inline-flex items-center gap-1.5 text-[13px]">
              To
              <input type="time" className={inputClass} value={draft.to} disabled={dead} onChange={(event) => setEdit({ ...draft, to: event.target.value })} />
            </label>
          </div>
          <p className="text-[12.5px] text-muted">Times are in your phone's zone, {phoneZone()}. A To before From runs past midnight.</p>
          {edit && problem && <p className="text-[13px] text-danger">{problem}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={dead || !edit || !!problem}
              onClick={() => void save(withSchedule(setting, draft)).then((saved) => saved && alive() && setEdit(null))}
            >
              Save schedule
            </Button>
            {hasSchedule && (
              <Button size="sm" variant="ghost" disabled={dead} onClick={() => void save(withoutSchedule(setting)).then((saved) => saved && alive() && setEdit(null))}>
                Turn schedule off
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 px-4 py-3" data-testid="ideas-only-reaches">
          <span className="text-[14px] font-medium">What still reaches me</span>
          <div className="flex flex-wrap gap-2">
            <label className={switchClass}>
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--pc-accent)]"
                checked={ringReaches(setting)}
                disabled={dead}
                onChange={(event) => void save({ ...setting, reaches: { ...setting.reaches, ring: event.target.checked } })}
              />
              The Mayor's ring
            </label>
            <label className={switchClass}>
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--pc-accent)]"
                checked={emergencyReaches(setting)}
                disabled={dead}
                onChange={(event) => void save({ ...setting, reaches: { ...setting.reaches, emergency: event.target.checked } })}
              />
              Emergencies
            </label>
          </div>
          <p className="text-[12.5px] text-muted">While Ideas only is on, everything else is kept for later and not sent to this phone.</p>
        </div>
      </Card>
    </section>
  );
}
