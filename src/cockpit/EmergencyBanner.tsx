// src/cockpit/EmergencyBanner.tsx — an emergency events record (docs/protocol.md §22) at the top of
// every screen, above the ring and the outbox note, until he taps it. The tap clears it for good (it
// is a setting, so a reload does not bring it back) and opens what it is about: the bead it names, or
// the Talk line when it names none. One whose job is done (an information emergency) also has Dismiss,
// which puts it away without leaving the screen, and leaves by itself after ten minutes (mw-gq6.277).
import { Icon, cx } from '../ui';
import { navigate } from '../router';
import { eventsRepo, isInformation } from '../data/repositories';
import type { EventRow } from '../data/db';
import type { Route } from '../nav/route';
import { EMERGENCY_TAG } from '../push/classOptions';
import { useEmergency } from './hooks';

/** Where a tap on an emergency lands: its bead's page, else the Talk line. */
function emergencyRoute(event: EventRow): Route {
  return event.bead ? { view: 'bead', id: event.bead } : { view: 'line' };
}

/** The push's notification, if still up, is dealt with by the same tap. */
function closeEmergencyNotification(): void {
  if (!('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.ready
    .then((registration) => registration.getNotifications({ tag: EMERGENCY_TAG }))
    .then((notifications) => notifications.forEach((notification) => notification.close()))
    .catch(() => undefined);
}

export function EmergencyBanner() {
  const emergency = useEmergency();
  if (!emergency) return null;
  const target = emergencyRoute(emergency);
  // An emergency whose job is done tells him something and asks nothing: he can put it away without leaving the screen.
  const information = isInformation(emergency);
  return (
    <section role="alert" aria-label="Emergency" className="flex shrink-0 items-stretch gap-2 px-2 pt-2">
      <button
        type="button"
        onClick={() => {
          void eventsRepo.clearEmergency(emergency.seq);
          closeEmergencyNotification();
          navigate(target);
        }}
        className={cx('flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-blocked/30 bg-blocked/12 px-3 py-2 text-left text-sm text-blocked')}
      >
        <Icon name="alarm" size={18} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-semibold">Emergency</span>
          {emergency.detail && <span className="wrap-anywhere">{emergency.detail}</span>}
          <span className="text-[12px] opacity-80">{target.view === 'bead' ? `Tap to clear and open ${emergency.bead}` : 'Tap to clear and open the Talk line'}</span>
        </span>
      </button>
      {information && (
        <button
          type="button"
          onClick={() => {
            void eventsRepo.clearEmergency(emergency.seq);
            closeEmergencyNotification();
          }}
          className="shrink-0 rounded-xl border border-blocked/30 px-3 text-sm font-medium text-blocked"
        >
          Dismiss
        </button>
      )}
    </section>
  );
}
