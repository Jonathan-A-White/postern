// src/cockpit/EmergencyScreen.tsx — where a tap on an emergency notification lands (mw-gq6.277). The
// push names no word of the record (its words are sealed), so this reads the emergency events the
// phone holds and shows them, newest first: each with its words, who raised it and when. A phone that
// has not read the record yet shows that it is looking, not an empty page.
import { EmptyState, Icon, IconButton, Spinner, TimeAgo } from '../ui';
import { Screen } from './Shell';
import { useBeadTitles, useRecentEmergencies } from './hooks';
import { useSpeaking } from './useSpeaking';
import { isSupported as canSpeak, speak, stop as stopSpeaking } from '../services/speech';
import { navigate } from '../router';
import type { EventRow } from '../data/db';

function EmergencyCard({ event }: { event: EventRow }) {
  const titles = useBeadTitles();
  const speakKey = `emergency:${event.seq}`;
  const reading = useSpeaking(speakKey);
  return (
    <article aria-label="Emergency" className="flex flex-col gap-2 rounded-2xl border border-blocked/40 bg-surface p-4">
      <div className="flex items-center gap-2 text-blocked">
        <Icon name="alarm" size={18} />
        <h2 className="text-[15px] font-semibold">Emergency</h2>
        {event.detail && canSpeak() && (
          <IconButton
            icon={reading ? 'stop' : 'speaker'}
            label={reading ? 'Stop reading' : 'Read aloud'}
            size="sm"
            className="ml-auto"
            onClick={() => (reading ? stopSpeaking() : speak(event.detail, { titles, key: speakKey }))}
          />
        )}
      </div>
      {event.detail ? <p className="text-[15px] wrap-anywhere whitespace-pre-wrap">{event.detail}</p> : <p className="text-[15px] text-muted">It carried no words.</p>}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-faint">
        {event.actor && <span>{event.actor}</span>}
        <span className="flex items-center gap-1">
          <Icon name="clock" size={14} />
          <TimeAgo at={event.ts} />
        </span>
      </p>
      {event.bead && (
        <button type="button" onClick={() => navigate({ view: 'bead', id: event.bead })} className="self-start text-[13px] font-medium text-accent underline">
          {`Open ${event.bead}`}
        </button>
      )}
    </article>
  );
}

export function EmergencyScreen() {
  const events = useRecentEmergencies();
  return (
    <Screen title="Emergency" back={{ view: 'needs' }}>
      <div className="mx-auto flex max-w-xl flex-col gap-3">
        {events === undefined && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> Looking for the emergency
          </p>
        )}
        {events?.length === 0 && (
          <EmptyState icon="alarm" title="No emergency held yet">
            The phone has not read the emergency's record. It will show here when it does.
          </EmptyState>
        )}
        {events?.map((event) => <EmergencyCard key={event.seq} event={event} />)}
      </div>
    </Screen>
  );
}
