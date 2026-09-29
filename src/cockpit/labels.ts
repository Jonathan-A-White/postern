// src/cockpit/labels.ts — the words and icons the cockpit uses for each kind of
// need and each bead type, in one place so every screen says the same thing.
import type { IconName, Tone } from '../ui';
import type { NeedKind } from '../model/view';

export const NEED_META: Record<NeedKind, { label: string; icon: IconName; tone: Tone; verb: string }> = {
  question: { label: 'Question', icon: 'talk', tone: 'needs', verb: 'The Mayor asks' },
  approve: { label: 'Approve', icon: 'release', tone: 'held', verb: 'Held for your word' },
  verify: { label: 'Verify', icon: 'eye', tone: 'done', verb: 'Landed — check it' },
  stale: { label: 'Still wanted?', icon: 'clock', tone: 'held', verb: 'Has this gone stale' },
  demo: { label: 'Demo', icon: 'play', tone: 'ready', verb: 'A demo is ready' },
  hands: { label: 'Your hands', icon: 'hand', tone: 'needs', verb: 'Only you can do this' },
  alarm: { label: 'Alarm', icon: 'alarm', tone: 'danger', verb: 'Something is wrong' },
};

export function typeIcon(type: string, isMap = false): IconName {
  if (isMap) return 'map';
  switch (type) {
    case 'epic':
      return 'layers';
    case 'bug':
      return 'alarm';
    case 'feature':
      return 'sparkle';
    default:
      return 'check';
  }
}

export function priorityLabel(priority: number): string {
  return `P${priority}`;
}

export function priorityTone(priority: number): Tone {
  return priority <= 0 ? 'danger' : priority === 1 ? 'needs' : 'neutral';
}

export function statusWord(status: string): string {
  switch (status) {
    case 'in_progress':
      return 'In progress';
    case 'deferred':
      return 'Held';
    case 'closed':
      return 'Closed';
    case 'open':
      return 'Open';
    default:
      return status;
  }
}
