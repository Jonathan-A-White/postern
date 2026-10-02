// mw-ym1qi9.1: the Talk header's speaker (the Mayor's last message) is a toggle too.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpeakAll } from '../../src/cockpit/Conversation';
import { stop } from '../../src/services/speech';
import type { ConversationItem } from '../../src/model/conversation';

class FakeUtterance {
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  text: string;
  constructor(text: string) {
    this.text = text;
  }
}

const items = [{ id: 'm1', speaker: 'mayor', text: 'Three things landed.' }] as unknown as ConversationItem[];

describe('the header speaker reads the Mayor\'s last message, then stops it', () => {
  const utterances: FakeUtterance[] = [];
  const cancel = vi.fn();
  beforeEach(() => {
    utterances.length = 0;
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    vi.stubGlobal('speechSynthesis', { speak: (u: FakeUtterance) => utterances.push(u), cancel, getVoices: () => [] });
    stop();
    cancel.mockClear();
  });
  afterEach(() => {
    cleanup();
    stop();
    vi.unstubAllGlobals();
  });

  it('shows Stop reading while it reads, stops on a second tap', async () => {
    render(<SpeakAll items={items} />);
    await userEvent.click(screen.getByRole('button', { name: "Read the Mayor's last message aloud" }));
    expect(utterances).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Stop reading' }));
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: "Read the Mayor's last message aloud" })).toBeInTheDocument();
  });

  it('goes back to the speaker when the reading ends by itself', async () => {
    render(<SpeakAll items={items} />);
    await userEvent.click(screen.getByRole('button', { name: "Read the Mayor's last message aloud" }));
    act(() => utterances[0].onend?.());
    expect(screen.getByRole('button', { name: "Read the Mayor's last message aloud" })).toBeInTheDocument();
  });
});
