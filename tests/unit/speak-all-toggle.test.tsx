// mw-ym1qi9.1: the Talk header's speaker (the Mayor's last message) is a toggle too.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpeakAll } from '../../src/cockpit/Conversation';
import { stop } from '../../src/services/speech';
import { installHonestSpeech, type HonestSpeech } from '../support/honest-speech';
import type { ConversationItem } from '../../src/model/conversation';

const items = [{ id: 'm1', speaker: 'mayor', text: 'Three things landed.' }] as unknown as ConversationItem[];

describe('the header speaker reads the Mayor\'s last message, then stops it', () => {
  let speech: HonestSpeech;
  let cancel: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    speech = installHonestSpeech();
    stop();
    cancel = vi.spyOn(speech.synth, 'cancel');
  });
  afterEach(() => {
    cleanup();
    stop();
    speech.uninstall();
  });

  it('shows Stop reading while it reads, stops on a second tap', async () => {
    render(<SpeakAll items={items} />);
    await userEvent.click(screen.getByRole('button', { name: "Read the Mayor's last message aloud" }));
    expect(speech.log).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Stop reading' }));
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: "Read the Mayor's last message aloud" })).toBeInTheDocument();
  });

  it('goes back to the speaker when the reading ends by itself', async () => {
    render(<SpeakAll items={items} />);
    await userEvent.click(screen.getByRole('button', { name: "Read the Mayor's last message aloud" }));
    act(() => speech.finish());
    expect(screen.getByRole('button', { name: "Read the Mayor's last message aloud" })).toBeInTheDocument();
  });
});
