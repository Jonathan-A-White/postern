// src/ui/tokens.ts — the class-name helpers the cockpit's components share: joining
// class names, and the tones every status colour is one of (src/index.css).
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export type Tone = 'needs' | 'working' | 'ready' | 'blocked' | 'held' | 'done' | 'neutral' | 'danger';

export const TONE_DOT: Record<Tone, string> = {
  needs: 'bg-needs',
  working: 'bg-working',
  ready: 'bg-ready',
  blocked: 'bg-blocked',
  held: 'bg-held',
  done: 'bg-done',
  neutral: 'bg-faint',
  danger: 'bg-danger',
};
