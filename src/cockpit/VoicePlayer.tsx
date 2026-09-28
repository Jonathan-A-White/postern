// src/cockpit/VoicePlayer.tsx — a voice note's player (mw-f758y.26): one button
// that reads Play, and once playback starts Pause (tapping it stops at once,
// and Play resumes from the same place), with how far along it is. The native
// controls are left off so the button is the same on every phone.
import { useEffect, useRef, useState } from 'react';
import { IconButton } from '../ui';

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function VoicePlayer({ src }: { src: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    const sync = () => {
      setPlaying(!element.paused && !element.ended);
      setPosition(element.currentTime || 0);
      setDuration(Number.isFinite(element.duration) ? element.duration : 0);
    };
    const events = ['play', 'playing', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'durationchange'];
    events.forEach((name) => element.addEventListener(name, sync));
    return () => events.forEach((name) => element.removeEventListener(name, sync));
  }, [src]);

  function toggle() {
    const element = audio.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => setPlaying(false));
    else element.pause();
  }

  const progress = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  return (
    <div className="flex h-10 w-64 max-w-full items-center gap-2" data-testid="voice-player">
      <audio ref={audio} src={src} preload="metadata" />
      <IconButton icon={playing ? 'pause' : 'play'} label={playing ? 'Pause voice note' : 'Play voice note'} tone="accent" size="sm" onClick={toggle} />
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-label="Voice note position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
        <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
      </div>
      <span className="w-[4.5ch] shrink-0 text-right text-[11.5px] tabular-nums text-muted">{clock(playing || position > 0 ? position : duration)}</span>
    </div>
  );
}
