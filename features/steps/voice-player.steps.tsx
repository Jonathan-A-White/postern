// features/steps/voice-player.steps.tsx — runs features/voice-player.feature under
// vitest via @amiceli/vitest-cucumber. jsdom has no media playback, so play()
// and pause() are stubbed to flip the element's paused state and fire events.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { VoicePlayer } from '../../src/cockpit/VoicePlayer';

afterAll(() => {
  cleanup();
  vi.restoreAllMocks();
});

const feature = await loadFeature('features/voice-player.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('mw-f758y.26: a voice note that is playing can be paused, and the control offers play again', ({ Given, When, Then }) => {
    let paused = true;
    let audio: HTMLAudioElement;

    Given('a voice note in a thread', () => {
      cleanup();
      paused = true;
      Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get: () => paused });
      vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
        paused = false;
        this.dispatchEvent(new Event('play'));
        return Promise.resolve();
      });
      vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
        paused = true;
        this.dispatchEvent(new Event('pause'));
      });
      const { container } = render(<VoicePlayer src="blob:voice" />);
      audio = container.querySelector('audio') as HTMLAudioElement;
    });

    When('he taps play', () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play voice note' }));
    });

    Then('the voice note is playing and the control offers pause', async () => {
      expect(audio.paused).toBe(false);
      expect(await screen.findByRole('button', { name: 'Pause voice note' })).toBeInTheDocument();
    });

    When('he taps pause', () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pause voice note' }));
    });

    Then('the voice note is paused and the control offers play', async () => {
      expect(audio.paused).toBe(true);
      expect(await screen.findByRole('button', { name: 'Play voice note' })).toBeInTheDocument();
    });
  });
});
