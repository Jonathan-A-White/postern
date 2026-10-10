// src/cockpit/SpeakingBar.tsx — mw-q6n8m0.9: the one bar for anything read aloud: Pause (Resume while
// paused), Restart and Stop, each 44 px high, shown while something speaks or waits paused. In flow, never over text.
// The Shell shows it for every read-aloud button, and for the Mayor's answer once the Talk line is left (it waits
// paused there); on the Talk line itself the answer carries its own buttons beside its speaker (mw-q6n8m0.11).
import { Button } from '../ui';
import { pause, restart, resume, stop } from '../services/speech';
import { useSpeech } from './useSpeaking';

export interface SpeakingBarProps {
  /** Show the bar for every speech but the one started under this key. */
  except?: string;
}

export function SpeakingBar({ except }: SpeakingBarProps) {
  const speech = useSpeech();
  if (speech.status === 'idle') return null;
  if (except !== undefined && speech.key === except) return null;
  const paused = speech.status === 'paused';
  return (
    <section aria-label="Speaking" data-testid="speaking-bar" className="flex shrink-0 items-center justify-center gap-2 border-t border-line bg-surface px-3 py-2">
      <Button icon={paused ? 'play' : 'pause'} variant={paused ? 'primary' : 'secondary'} className="min-h-11" onClick={paused ? resume : pause}>
        {paused ? 'Resume' : 'Pause'}
      </Button>
      <Button icon="refresh" className="min-h-11" onClick={restart}>
        Restart
      </Button>
      <Button icon="stop" className="min-h-11" onClick={stop}>
        Stop
      </Button>
    </section>
  );
}
