// mw-lcirxg: when the phone's voice engine fails to speak, the screen says why instead of staying silent: under a message
// ('Voice failed: audio-busy', the Play button stays) and on Me's 'Test voice' line ('Spoken' when it worked).
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Conversation } from '../../src/cockpit/Conversation';
import { MeScreen } from '../../src/cockpit/MeScreen';
import { db } from '../../src/data/db';
import { stop } from '../../src/services/speech';
import { failSpeech, installHonestSpeech, type HonestSpeech } from '../support/honest-speech';
import type { ConversationItem } from '../../src/model/conversation';

const items = [{ id: 'm1', speaker: 'mayor', speakerLabel: 'Mayor', kind: 'text', text: 'Three things landed.', at: Date.now(), onChain: false }] as unknown as ConversationItem[];

let speech: HonestSpeech;
beforeEach(async () => {
  await Promise.all([db.settings.clear(), db.view.clear()]);
  speech = installHonestSpeech();
  stop();
});
afterEach(() => {
  cleanup();
  stop();
  speech.uninstall();
});
afterAll(() => cleanup());

describe('a message whose voice fails says why', () => {
  it('shows "Voice failed: audio-busy" under the message and keeps the Play button', async () => {
    failSpeech(speech, 'audio-busy');
    render(<Conversation items={items} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Read aloud' }));
    act(() => speech.advance(0));
    expect(await screen.findByText('Voice failed: audio-busy')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read aloud' })).toBeInTheDocument();
  });

  it('shows no note when the message is spoken', async () => {
    render(<Conversation items={items} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Read aloud' }));
    act(() => speech.finishAll());
    expect(screen.queryByText(/Voice failed/)).not.toBeInTheDocument();
  });

  it('shows no note when Stop cancels the reading', async () => {
    render(<Conversation items={items} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Read aloud' }));
    act(() => speech.advance(0));
    await userEvent.click(await screen.findByRole('button', { name: 'Stop reading' }));
    act(() => speech.advance(0));
    expect(screen.queryByText(/Voice failed/)).not.toBeInTheDocument();
  });
});

describe('Me has a Test voice line', () => {
  it('speaks one fixed sentence over the current output and says Spoken', async () => {
    render(<MeScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'Test voice' }));
    await waitFor(() => expect(speech.log).toHaveLength(1));
    act(() => speech.finishAll());
    expect(await screen.findByText('Spoken')).toBeInTheDocument();
    expect(speech.log[0].text).toMatch(/voice/i);
  });

  it('shows "Voice failed: not-allowed" and keeps the button when the engine refuses', async () => {
    failSpeech(speech, 'not-allowed');
    render(<MeScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'Test voice' }));
    act(() => speech.advance(0));
    expect(await screen.findByText('Voice failed: not-allowed')).toBeInTheDocument();
    expect(screen.queryByText('Spoken')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test voice' })).toBeEnabled();
  });
});
