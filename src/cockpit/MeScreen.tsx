// src/cockpit/MeScreen.tsx — the cockpit's own state (plans/0021 decision 14):
// how long the key stays unlocked and a way to lock it now, the Mayor he trusts
// (and any different key the backend has offered), the live connection and what
// the backend can do, notifications per kind of message, and the version.
import { useEffect, useState } from 'react';
import { Banner, Button, Card, Chip, Dot, Icon, SectionTitle, TimeAgo } from '../ui';
import { Screen } from './Shell';
import { liveLabel } from './liveLabel';
import { useUnlockedKey, useViewIndex } from './hooks';
import { MoveHomeButtons } from './MoveHome';
import { HOMES, useStandby } from '../services/standby';
import { lock, sessionExpiresAt } from '../services/keySession';
import { describeBuild } from '../services/buildLine';
import { refreshNow, stopLive, useLive } from '../services/live';
import { acceptOfferedMayorKey, fingerprint } from '../services/me';
import { isPushSubscribed, pushSupported, rememberPushSubscribed, subscribeToPush } from '../services/push';
import { publicKeyHexFromMasterKey } from '../services/vault';
import { settingsRepo } from '../data/repositories';
import { DEFAULT_NOTIFICATION_SETTINGS, MESSAGE_CLASSES, type ClassNotificationSettings, type NotificationSettingsMap, type PushClass } from '../push/classOptions';
import { formatRoute } from '../nav/route';
import { toast } from '../ui/toastStore';

const CLASS_LABELS: Record<PushClass, string> = {
  'decision-needed': 'Decisions',
  landing: 'Landings',
  alarm: 'Alarms',
  message: 'Messages',
  'move-home': 'Move home',
};

const SWITCHES: { key: keyof ClassNotificationSettings; label: string }[] = [
  { key: 'sound', label: 'Sound' },
  { key: 'vibrate', label: 'Vibrate' },
  { key: 'stayUntilDismissed', label: 'Stay until dismissed' },
  { key: 'quiet', label: 'Quiet' },
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-[14px] text-muted">{label}</span>
      <span className="min-w-0 text-right text-[14px]">{children}</span>
    </div>
  );
}

function Notifications() {
  const key = useUnlockedKey();
  const [settings, setSettings] = useState<NotificationSettingsMap | null>(null);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // A read that lands after the screen is gone must set no state (mw-j0f2d.42).
    let gone = false;
    void settingsRepo.getNotificationSettings().then((loaded) => {
      if (!gone) setSettings(loaded);
    });
    void isPushSubscribed().then((on) => {
      if (!gone) setSubscribed(on);
    });
    return () => {
      gone = true;
    };
  }, []);

  async function enable() {
    if (!key) return;
    setBusy(true);
    try {
      await subscribeToPush({ publicKeyHex: publicKeyHexFromMasterKey(key), unlockedKey: key });
      await rememberPushSubscribed();
      setSubscribed(true);
      toast('Notifications are on');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  function toggle(messageClass: PushClass, switchKey: keyof ClassNotificationSettings, checked: boolean) {
    if (!settings) return;
    const next = { ...settings, [messageClass]: { ...settings[messageClass], [switchKey]: checked } };
    setSettings(next);
    void settingsRepo.setNotificationSettings(next);
  }

  return (
    <section className="flex flex-col gap-2" aria-label="Notifications">
      <SectionTitle>Notifications</SectionTitle>
      <Card className="divide-y divide-line">
        <Row label="On this phone">
          {!pushSupported() ? (
            <span className="text-faint">Not supported here</span>
          ) : subscribed ? (
            <Chip tone="done" icon="check">
              On
            </Chip>
          ) : (
            <Button size="sm" variant="primary" icon="bell" busy={busy} onClick={() => void enable()} disabled={!key}>
              Turn on
            </Button>
          )}
        </Row>
        {settings &&
          MESSAGE_CLASSES.map((messageClass) => (
            <div key={messageClass} className="flex flex-col gap-2 px-4 py-3" data-testid={`notification-row-${messageClass}`}>
              <span className="text-[14px] font-medium">{CLASS_LABELS[messageClass]}</span>
              <div className="flex flex-wrap gap-2">
                {SWITCHES.map(({ key: switchKey, label }) => (
                  <label key={switchKey} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[13px]">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--pc-accent)]"
                      checked={settings[messageClass][switchKey]}
                      onChange={(event) => toggle(messageClass, switchKey, event.target.checked)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        {settings && (
          <p className="px-4 py-3 text-[13px] text-muted">
            Vibrate without Sound still plays the phone's notification sound unless the phone is on vibrate; for vibrate only, set Postern's notification sound
            to None in the phone's settings.
          </p>
        )}
        {settings && (
          <div className="px-4 py-3">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSettings(DEFAULT_NOTIFICATION_SETTINGS);
                void settingsRepo.resetNotificationSettings();
              }}
            >
              Reset to defaults
            </Button>
          </div>
        )}
      </Card>
    </section>
  );
}

export function MeScreen() {
  const key = useUnlockedKey();
  const live = useLive();
  const expires = sessionExpiresAt();
  const label = liveLabel(live);
  const build = describeBuild(__APP_VERSION__);
  const standby = useStandby();
  const viewState = useViewIndex();
  // In standby the view on the phone may be from a home that has since changed hands.
  const home = standby ? undefined : viewState?.index.view.host || undefined;

  return (
    <Screen title="Me" subtitle="Key, Mayor, connection, notifications">
      <div className="flex flex-col gap-6">
        <p aria-label="Build" className="flex flex-col gap-0.5">
          <span className="text-[14px] text-fg">{build.build}</span>
          {build.version && <span className="text-[11.5px] text-faint">{build.version}</span>}
        </p>

        <section className="flex flex-col gap-2" aria-label="Key">
          <SectionTitle>Key</SectionTitle>
          <Card className="divide-y divide-line">
            <Row label="State">
              {key ? (
                <span className="inline-flex items-center gap-1.5">
                  <Dot tone="done" /> Unlocked
                </span>
              ) : (
                'Locked'
              )}
            </Row>
            {expires && <Row label="Stays unlocked until">{new Date(expires).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</Row>}
            {key && <Row label="Your key">{<span className="font-mono text-[12.5px]">{fingerprint(publicKeyHexFromMasterKey(key))}</span>}</Row>}
            <div className="flex flex-wrap gap-2 px-4 py-3">
              {key && (
                <Button
                  size="sm"
                  icon="lock"
                  onClick={() => {
                    stopLive();
                    lock();
                  }}
                >
                  Lock now
                </Button>
              )}
              <a href={formatRoute({ view: 'key' })} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm text-muted hover:bg-raised hover:text-fg">
                <Icon name="key" size={16} />
                Manage key and licence
              </a>
            </div>
          </Card>
        </section>

        <section className="flex flex-col gap-2" aria-label="The Mayor">
          <SectionTitle>The Mayor</SectionTitle>
          <Card className="divide-y divide-line">
            <Row label="Trusted key">
              {live.mayorKey ? <span className="font-mono text-[12.5px]">{fingerprint(live.mayorKey)}</span> : <span className="text-faint">Not known yet</span>}
            </Row>
            {live.offeredMayorKey && (
              <div className="px-4 py-3">
                <Banner
                  tone="needs"
                  icon="key"
                  action={
                    <Button size="sm" onClick={() => void acceptOfferedMayorKey().then(() => refreshNow())}>
                      Trust it
                    </Button>
                  }
                >
                  The backend now names {fingerprint(live.offeredMayorKey)}. Only trust it if you moved or re-keyed the Mayor.
                </Banner>
              </div>
            )}
          </Card>
        </section>

        <section className="flex flex-col gap-2" aria-label="Prompts">
          <SectionTitle>Prompts</SectionTitle>
          <Card>
            <a href={formatRoute({ view: 'prompts' })} className="flex items-center gap-3 px-4 py-3 text-[14px] hover:bg-raised/60">
              <Icon name="sparkle" size={16} className="text-muted" />
              <span className="flex-1">Prompts</span>
              <span className="text-[13px] text-muted">Saved prompts: Run or Edit</span>
              <Icon name="forward" size={15} className="text-faint" />
            </a>
          </Card>
        </section>

        <section className="flex flex-col gap-2" aria-label="Home">
          <SectionTitle>Home</SectionTitle>
          <Card className="divide-y divide-line">
            <Row label="The factory's home">{home ?? <span className="text-faint">unknown</span>}</Row>
            <div className="px-4 py-3">
              <MoveHomeButtons hosts={HOMES} current={home} />
            </div>
          </Card>
        </section>

        <section className="flex flex-col gap-2" aria-label="Connection">
          <SectionTitle>Connection</SectionTitle>
          <Card className="divide-y divide-line">
            <Row label="Status">
              <span className="inline-flex items-center gap-1.5">
                <Dot tone={label.tone === 'neutral' ? 'neutral' : label.tone} pulse={live.status === 'live'} />
                {label.text}
              </span>
            </Row>
            <Row label="Last heard">{live.lastHeard ? <TimeAgo at={live.lastHeard} /> : '—'}</Row>
            <Row label="Backend can">
              {live.me?.features.length ? (
                <span className="flex flex-wrap justify-end gap-1">
                  {live.me.features.map((feature) => (
                    <Chip key={feature}>{feature}</Chip>
                  ))}
                </span>
              ) : (
                <span className="text-faint">the old protocol only</span>
              )}
            </Row>
            {live.error && <p className="px-4 py-3 text-[13px] text-danger">{live.error}</p>}
            <div className="px-4 py-3">
              <Button size="sm" icon="refresh" onClick={() => void refreshNow()} disabled={!key}>
                Refresh now
              </Button>
            </div>
          </Card>
        </section>

        <Notifications />
      </div>
    </Screen>
  );
}
