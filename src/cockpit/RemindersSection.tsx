// src/cockpit/RemindersSection.tsx — Settings > Reminders (mw-ev7oyy.9): how a To do card's reminder reaches him,
// apart from the Notifications rows (a phone gives a web app one notification channel, so this is the app's own
// setting, read by the service worker for every reminder push: src/push/reminder.ts). Sound and buzz on or off,
// and quiet hours in which a reminder still shows, silently. A change is kept at once.
import { useEffect, useState } from 'react';
import { Card, SectionTitle } from '../ui';
import { settingsRepo } from '../data/repositories';
import { DEFAULT_REMINDER_SETTINGS, type ReminderSettings } from '../push/reminder';
import { phoneZone } from '../model/ideasOnly';

const switchClass = 'inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[13px]';
const inputClass = 'h-8 rounded-lg border border-line bg-transparent px-2 text-[13px] disabled:opacity-50';

const isTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function RemindersSection() {
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [span, setSpan] = useState({ from: DEFAULT_REMINDER_SETTINGS.quietFrom, to: DEFAULT_REMINDER_SETTINGS.quietTo });

  useEffect(() => {
    // A read that lands after the screen is gone must set no state (mw-j0f2d.42).
    let gone = false;
    void settingsRepo.getReminderSettings().then((loaded) => {
      if (gone) return;
      setSettings(loaded);
      setSpan({ from: loaded.quietFrom, to: loaded.quietTo });
    });
    return () => {
      gone = true;
    };
  }, []);

  const keep = (next: ReminderSettings) => {
    setSettings(next);
    void settingsRepo.setReminderSettings(next);
  };
  const setTimes = (next: { from: string; to: string }) => {
    setSpan(next);
    if (settings && isTime(next.from) && isTime(next.to)) keep({ ...settings, quietFrom: next.from, quietTo: next.to });
  };

  return (
    <section className="flex flex-col gap-2" aria-label="Reminders">
      <SectionTitle>Reminders</SectionTitle>
      <Card className="divide-y divide-line">
        <p className="px-4 py-3 text-[13px] text-muted">When a To do card falls due. These switches are for reminders only; the Notifications above do not change them.</p>
        {settings && (
          <>
            <div className="flex flex-col gap-2 px-4 py-3">
              <label className={switchClass + ' self-start'}>
                <input type="checkbox" className="h-4 w-4 accent-[var(--pc-accent)]" checked={settings.sound} onChange={(event) => keep({ ...settings, sound: event.target.checked })} />
                Sound and buzz
              </label>
              <p className="text-[12.5px] text-muted">{settings.sound ? 'A reminder sounds and buzzes.' : 'A reminder shows without sound or buzz.'}</p>
            </div>
            <div className="flex flex-col gap-2 px-4 py-3">
              <label className={switchClass + ' self-start'}>
                <input type="checkbox" className="h-4 w-4 accent-[var(--pc-accent)]" checked={settings.quietHours} onChange={(event) => keep({ ...settings, quietHours: event.target.checked })} />
                Quiet hours
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  From
                  <input type="time" className={inputClass} value={span.from} disabled={!settings.quietHours} onChange={(event) => setTimes({ ...span, from: event.target.value })} />
                </label>
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  To
                  <input type="time" className={inputClass} value={span.to} disabled={!settings.quietHours} onChange={(event) => setTimes({ ...span, to: event.target.value })} />
                </label>
              </div>
              <p className="text-[12.5px] text-muted">
                {settings.quietHours
                  ? `A reminder between ${settings.quietFrom} and ${settings.quietTo} (${phoneZone()}) still shows, without sound or buzz.`
                  : 'Turn on to have reminders show without sound or buzz between two times.'}
              </p>
            </div>
          </>
        )}
      </Card>
    </section>
  );
}
