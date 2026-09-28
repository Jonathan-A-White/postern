// src/cockpit/AlarmScreen.tsx — where a tap on a watchdog alarm lands (mw-f758y.25):
// the alarm itself, as the push carried it ("desktop unreachable", since when),
// with a way on to the Needs-you queue. The alarm has no record behind it, so this
// is all the phone knows of it.
import { Button, Icon, TimeAgo } from '../ui';
import { Screen } from './Shell';
import { navigate } from '../router';

export function AlarmScreen({ title, body, ts }: { title?: string; body?: string; ts?: number }) {
  return (
    <Screen title="Alarm" back={{ view: 'needs' }}>
      <article aria-label="Alarm" className="mx-auto flex max-w-xl flex-col gap-3 rounded-2xl border border-danger/40 bg-surface p-5">
        <div className="flex items-center gap-3 text-danger">
          <Icon name="alarm" size={22} />
          <h2 className="text-[18px] leading-tight font-semibold">{title || 'Alarm'}</h2>
        </div>
        {body && <p className="text-[15px] text-muted">{body}</p>}
        {ts !== undefined && (
          <p className="flex items-center gap-2 text-[13px] text-faint">
            <Icon name="clock" size={14} />
            Raised <TimeAgo at={ts} />
          </p>
        )}
        <div className="pt-2">
          <Button onClick={() => navigate({ view: 'needs' })}>Open Needs you</Button>
        </div>
      </article>
    </Screen>
  );
}
