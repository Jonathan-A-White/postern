// tests/unit/read-aloud.test.tsx — mw-xhtcup.13: the Read-aloud control exists only where the phone
// can speak, speech stops when the screen that started it is left, and a need reads as its question,
// the Mayor's recommendation, then the options (the guards speech.feature AC-2/AC-4/AC-5 gave before 78f06d0).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { EmergencyScreen } from '../../src/cockpit/EmergencyScreen';
import { NeedCard } from '../../src/cockpit/NeedCard';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { stop } from '../../src/services/speech';
import { db } from '../../src/data/db';
import { eventsRepo, messagesRepo, viewRepo } from '../../src/data/repositories';
import type { Need } from '../../src/model/view';
import { fixtureView } from '../support/cockpit-fixture';

class FakeUtterance {
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  text: string;
  constructor(text: string) {
    this.text = text;
  }
}

const utterances: FakeUtterance[] = [];
const speakFn = vi.fn((u: FakeUtterance) => utterances.push(u));
const cancelFn = vi.fn();
const BEAD = 'mw-f758y.31';

const question: Need = {
  kind: 'question',
  bead: '',
  epic: '',
  title: 'Release the held story?',
  since: new Date().toISOString(),
  text: '',
  recommended: 'A: Release it',
  options: ['A: Release it', 'B: Hold'],
  blocks: 0,
  steps: [],
} as Need;

function canSpeak(): void {
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  vi.stubGlobal('speechSynthesis', { speak: speakFn, cancel: cancelFn, getVoices: () => [] });
  stop();
  cancelFn.mockClear();
}

function cannotSpeak(): void {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'speechSynthesis');
}

async function seed(): Promise<void> {
  const now = Date.now();
  const view = fixtureView(now);
  for (const bead of view.beads) if (bead.id === BEAD) bead.summary = 'Make the cockpit easy to use correctly.';
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
  const txid = '01'.repeat(32);
  await messagesRepo.put({
    id: `${txid}:0`,
    txid,
    vout: 0,
    seq: 1,
    class: 'message',
    to: '02'.padEnd(66, '0'),
    from: '03'.padEnd(66, '0'),
    ts: Math.floor(now / 1000),
    ciphertext: '',
    plaintext: 'Three things landed today.',
    direction: 'received',
    read: true,
  });
  await eventsRepo.addNew([{ seq: 1, ts: new Date(now).toISOString(), kind: 'alarm', bead: '', actor: 'doctor@desktop', from: '', to: '', detail: 'Disk almost full.', lane: 'emergency' }]);
}

/** Each screen the story names, rendered and settled on a Read-aloud control (or its absence). */
const SCREENS: { name: string; show: () => ReturnType<typeof render>; ready: () => Promise<unknown> }[] = [
  { name: 'a need card', show: () => render(<NeedCard need={question} />), ready: () => screen.findByRole('article') },
  { name: 'a conversation', show: () => render(<TalkScreen thread="general" />), ready: () => screen.findByTestId('conversation') },
  { name: 'a bead page', show: () => render(<BeadScreen id={BEAD} />), ready: () => screen.findByRole('region', { name: 'Description' }) },
  { name: 'the emergency screen', show: () => render(<EmergencyScreen />), ready: () => screen.findByText('Disk almost full.') },
];

const speakers = () => screen.queryAllByRole('button', { name: /^(Read aloud|Read the description aloud|Read the Mayor's last message aloud)$/ });

beforeEach(async () => {
  cleanup();
  utterances.length = 0;
  speakFn.mockClear();
  cancelFn.mockClear();
  await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.events.clear(), db.beadDetails.clear()]);
  await seed();
  window.history.replaceState(null, '', '/?v=talk&t=general');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each(SCREENS)('$name', ({ show, ready }) => {
  it('has no Read-aloud control where speechSynthesis is missing', async () => {
    cannotSpeak();
    show();
    await ready();
    expect(speakers()).toHaveLength(0);
  });

  it('has a Read-aloud control where speechSynthesis exists', async () => {
    canSpeak();
    show();
    await ready();
    await waitFor(() => expect(speakers().length).toBeGreaterThan(0));
  });

  it('stops the speech it started when it is left', async () => {
    canSpeak();
    const { unmount } = show();
    await ready();
    await userEvent.click((await screen.findAllByRole('button', { name: /^Read (aloud|the description aloud)$/ }))[0]);
    expect(speakFn).toHaveBeenCalled();
    cancelFn.mockClear();
    unmount();
    expect(cancelFn).toHaveBeenCalledTimes(1);
  });

  it('does not stop anything when it is left without speaking', async () => {
    canSpeak();
    const { unmount } = show();
    await ready();
    unmount();
    expect(cancelFn).not.toHaveBeenCalled();
  });
});

describe('what a need reads aloud', () => {
  it('is the question, the Mayor\'s recommendation, then the options in order', async () => {
    canSpeak();
    render(<NeedCard need={question} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Read aloud' }));
    // one utterance per sentence (mw-q6n8m0.9)
    const said = utterances.map((utterance) => utterance.text).join(' ');
    expect(said).toContain('Release the held story?');
    expect(said).toContain('The Mayor recommends Release it.');
    expect(said).not.toContain('recommends A');
    expect(said).toMatch(/A, Release it\. B, Hold\.$/);
    expect(said.indexOf('Release the held story?')).toBeLessThan(said.indexOf('The Mayor recommends'));
    expect(said.indexOf('The Mayor recommends')).toBeLessThan(said.indexOf('A, Release it.'));
  });

  it('reads a need with no options without any options sentence', async () => {
    canSpeak();
    render(<NeedCard need={{ ...question, kind: 'alarm', recommended: '', options: [] } as Need} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Read aloud' }));
    expect(utterances.map((utterance) => utterance.text).join(' ')).not.toContain('recommends');
  });
});
