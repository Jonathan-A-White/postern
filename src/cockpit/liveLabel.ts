// src/cockpit/liveLabel.ts — the connection's state in two words and a colour,
// for the badge in the shell and the Me screen.
import type { LiveState } from '../services/live';
import { relativeTime } from '../services/age';

export function liveLabel(live: LiveState, now: number = Date.now()): { text: string; tone: 'working' | 'needs' | 'blocked' | 'neutral' } {
  // The backend is out of reach but the phone is reading the anchor address itself (§22).
  if (live.chainLive && (live.status === 'reconnecting' || live.status === 'offline')) return { text: 'Live from the chain', tone: 'needs' };
  switch (live.status) {
    case 'live':
      return { text: 'Live', tone: 'working' };
    case 'polling':
      return { text: 'Polling', tone: 'needs' };
    case 'reconnecting':
      return { text: 'Reconnecting…', tone: 'needs' };
    case 'connecting':
      return { text: 'Connecting…', tone: 'neutral' };
    case 'unlicensed':
      return { text: 'No licence', tone: 'blocked' };
    case 'offline':
      return {
        text: live.lastHeard ? `Offline · ${relativeTime(new Date(live.lastHeard), new Date(now)).replace(' ago', '')}` : 'Offline',
        tone: 'blocked',
      };
    default:
      return { text: 'Locked', tone: 'neutral' };
  }
}
