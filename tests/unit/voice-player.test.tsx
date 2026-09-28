// tests/unit/voice-player.test.tsx — mw-f758y.26: a voice note in a thread can be
// paused once it is playing, and resumed. jsdom has no media playback, so
// play() and pause() are stubbed on the prototype to flip the element's
// paused state and fire the events a real browser fires.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoicePlayer } from '../../src/cockpit/VoicePlayer';

let pausedState = true;

beforeEach(() => {
  pausedState = true;
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get: () => pausedState });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    pausedState = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    pausedState = true;
    this.dispatchEvent(new Event('pause'));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function audioElement(container: HTMLElement): HTMLAudioElement {
  const audio = container.querySelector('audio');
  if (!audio) throw new Error('no audio element rendered');
  return audio;
}

describe('VoicePlayer', () => {
  it('offers Play before anything has started', () => {
    render(<VoicePlayer src="blob:voice" />);
    expect(screen.getByRole('button', { name: 'Play voice note' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause voice note' })).not.toBeInTheDocument();
  });

  it('shows Pause once playback starts, and tapping it pauses the audio at once', async () => {
    const { container } = render(<VoicePlayer src="blob:voice" />);
    const audio = audioElement(container);

    fireEvent.click(screen.getByRole('button', { name: 'Play voice note' }));
    expect(audio.paused).toBe(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Pause voice note' }));

    expect(audio.paused).toBe(true);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play voice note' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Pause voice note' })).not.toBeInTheDocument();
  });

  it('resumes from the same place when Play is tapped again', async () => {
    const { container } = render(<VoicePlayer src="blob:voice" />);
    const audio = audioElement(container);

    fireEvent.click(screen.getByRole('button', { name: 'Play voice note' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Pause voice note' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Play voice note' }));

    expect(audio.paused).toBe(false);
    expect(await screen.findByRole('button', { name: 'Pause voice note' })).toBeInTheDocument();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
  });

  it('goes back to Play when the note ends', async () => {
    const { container } = render(<VoicePlayer src="blob:voice" />);
    fireEvent.click(screen.getByRole('button', { name: 'Play voice note' }));
    await screen.findByRole('button', { name: 'Pause voice note' });

    pausedState = true;
    fireEvent.ended(audioElement(container));

    expect(await screen.findByRole('button', { name: 'Play voice note' })).toBeInTheDocument();
  });
});
