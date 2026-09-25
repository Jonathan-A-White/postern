// src/settings/NotificationSettingsScreen.tsx — mw-1589l.8: one row per
// message class (src/push/classOptions.ts) with its four switches, stored
// through settingsRepo so src/sw.ts's push handler applies the same values.
import { useEffect, useState } from 'react';
import { settingsRepo } from '../data/repositories';
import { MESSAGE_CLASSES, DEFAULT_NOTIFICATION_SETTINGS } from '../push/classOptions';
import type { ClassNotificationSettings, NotificationSettingsMap } from '../push/classOptions';
import type { MessageClass } from '../data/db';

const CLASS_LABELS: Record<MessageClass, string> = {
  'decision-needed': 'Decision needed',
  landing: 'Landing to verify',
  alarm: 'Alarm',
  message: 'Message',
};

const SWITCHES: Array<{ key: keyof ClassNotificationSettings; label: string }> = [
  { key: 'sound', label: 'Sound' },
  { key: 'vibrate', label: 'Vibrate' },
  { key: 'stayUntilDismissed', label: 'Stay until dismissed' },
  { key: 'quiet', label: 'Quiet' },
];

export function NotificationSettingsScreen() {
  const [settings, setSettings] = useState<NotificationSettingsMap | null>(null);

  useEffect(() => {
    void settingsRepo.getNotificationSettings().then(setSettings);
  }, []);

  function handleToggle(messageClass: MessageClass, key: keyof ClassNotificationSettings, checked: boolean) {
    if (!settings) return;
    const next: NotificationSettingsMap = {
      ...settings,
      [messageClass]: { ...settings[messageClass], [key]: checked },
    };
    setSettings(next);
    void settingsRepo.setNotificationSettings(next);
  }

  function handleReset() {
    setSettings(DEFAULT_NOTIFICATION_SETTINGS);
    void settingsRepo.resetNotificationSettings();
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-4 bg-slate-900 p-6 text-slate-200">
      <h1 className="text-2xl font-semibold">Notification settings</h1>
      <a className="text-sm underline" href="/">
        Back
      </a>

      {settings && (
        <div className="flex w-full max-w-md flex-col gap-4">
          {MESSAGE_CLASSES.map((messageClass) => (
            <section
              key={messageClass}
              data-testid={`notification-row-${messageClass}`}
              className="flex flex-col gap-2 rounded bg-slate-800 p-3"
            >
              <h2 className="font-semibold">{CLASS_LABELS[messageClass]}</h2>
              <div className="flex flex-wrap gap-3">
                {SWITCHES.map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-1 text-sm" htmlFor={`${messageClass}-${key}`}>
                    <input
                      id={`${messageClass}-${key}`}
                      type="checkbox"
                      checked={settings[messageClass][key]}
                      onChange={(e) => handleToggle(messageClass, key, e.target.checked)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </section>
          ))}

          <button className="rounded bg-slate-700 px-4 py-2" onClick={handleReset}>
            Reset to defaults
          </button>
        </div>
      )}
    </main>
  );
}
