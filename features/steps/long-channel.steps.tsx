// features/steps/long-channel.steps.tsx — runs features/long-channel.feature (mw-q6n8m0.6): the real
// TalkScreen on a bead's channel of 200 stored messages. The Markdown parser (react-markdown) and the
// per-message speaking hook are counting doubles: the first counts what is parsed, the second counts
// every redraw of a message bubble (each bubble calls it once per render).
import '@testing-library/react/dont-cleanup-after-each';
import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { createElement } from 'react';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { db, type MessageRow } from '../../src/data/db';
import { messagesRepo, viewRepo } from '../../src/data/repositories';
import { encodeThreadedMessage } from '../../src/services/threads';
import { encodeQuestion } from '../../src/services/questions';
import { fixtureView } from '../../tests/support/cockpit-fixture';

configure({ asyncUtilTimeout: 5000 });

const counts = vi.hoisted(() => ({ parsed: [] as string[], bubbles: 0 }));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => {
    counts.parsed.push(children);
    return createElement('p', null, children);
  },
}));
vi.mock('../../src/cockpit/useSpeaking', () => ({
  useSpeaking: (key: string) => {
    if (key.startsWith('message:')) counts.bubbles += 1;
    return false;
  },
}));

const BEAD = 'mw-f758y.30.2';
const THREAD = `bead:${BEAD}`;
const TOTAL = 200;
const WINDOW = 60;
const QUESTION_AT = 195;
const REPLIED_AT = 150;

const txidOf = (n: number) => `${'ab'.repeat(30)}${String(n).padStart(4, '0')}`;

function row(n: number, over: Partial<MessageRow> = {}): MessageRow {
  const txid = txidOf(n);
  return {
    id: `${txid}:0`,
    txid,
    vout: 0,
    seq: n,
    class: 'message',
    to: '02'.padEnd(66, '0'),
    from: '03'.padEnd(66, '0'),
    ts: 1_760_000_000 + n * 60,
    ciphertext: '',
    plaintext: `Message ${n}`,
    direction: 'received',
    read: true,
    thread: THREAD,
    ...over,
  };
}

async function seed(): Promise<void> {
  const now = Date.now();
  await viewRepo.save({ plaintext: JSON.stringify(fixtureView(now)), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
  for (let n = 1; n <= TOTAL; n += 1) {
    if (n === QUESTION_AT) await messagesRepo.put(row(n, { class: 'decision-needed', plaintext: encodeQuestion({ bead: BEAD, q: 'Ship it?', rec: 'A: yes', options: ['A: yes', 'B: no'] }) }));
    else await messagesRepo.put(row(n));
  }
  await messagesRepo.put(row(TOTAL + 1, { ts: 1_760_000_000 + 400 * 60, plaintext: encodeThreadedMessage({ text: 'A reply', re: txidOf(REPLIED_AT) }) }));
}

// byText, not byRole: a role query walks the whole 200-message DOM's accessibility tree and takes seconds
const onScreen = () => screen.queryAllByTestId('message');

/** Waits for some text without findByText: each failed poll of that pretty-prints the whole DOM into its
 * error, which on 200 messages starves the database's own re-query for seconds. */
const appears = (text: string) =>
  waitFor(
    () => {
      if (!screen.queryByText(text)) throw new Error(`no "${text}" yet`);
    },
    { interval: 300, timeout: 20_000 },
  );

/** The channel is drawn and the open's own mark-as-seen writes have settled. */
async function settled(): Promise<void> {
  await appears(`Message ${TOTAL}`);
  await new Promise((resolve) => setTimeout(resolve, 150));
}

afterAll(() => cleanup());

const feature = await loadFeature('features/long-channel.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    counts.parsed = [];
    counts.bubbles = 0;
    await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear()]);
    window.history.replaceState(null, '', '/?v=talk');
  });

  const open = async () => {
    await seed();
    render(<TalkScreen thread={THREAD} />);
    await settled();
  };

  Scenario('mw-q6n8m0.6 AC1: a new message re-parses only itself, not the whole channel', ({ Given, When, Then }) => {
    Given('a General channel of 200 messages is open', open);
    When('one new message arrives in the database', async () => {
      expect(counts.parsed.length).toBeGreaterThanOrEqual(WINDOW);
      counts.parsed = [];
      await messagesRepo.put(row(TOTAL + 2, { ts: 1_760_000_000 + 500 * 60, read: false, plaintext: 'Brand new words' }));
      await appears('Brand new words');
      // its own mark-as-seen write lands too; wait for it and for the screen to settle
      await waitFor(async () => expect((await messagesRepo.getAllOldestFirst()).filter((r) => !r.read)).toHaveLength(0));
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    Then('the Markdown parser ran for the new message only', () => {
      expect(counts.parsed).toEqual(['Brand new words']);
    });
  });

  Scenario('mw-q6n8m0.6 AC2: only the newest messages are drawn, with Show earlier above them', ({ Given, Then, And, When }) => {
    Given('a General channel of 200 messages is open', open);
    Then('only the newest 60 messages are on the screen', () => {
      expect(onScreen()).toHaveLength(WINDOW);
      expect(screen.getByText(`Message ${TOTAL}`)).toBeInTheDocument();
      expect(screen.getByText(`Message ${TOTAL - WINDOW + 1 + 1}`)).toBeInTheDocument();
      expect(screen.queryByText('Message 1')).toBeNull();
      expect(screen.queryByText(`Message ${TOTAL - WINDOW}`)).toBeNull();
      expect(screen.getByText(/Show earlier/)).toBeInTheDocument();
    });
    And('a reply row and a question card inside that window still show', () => {
      expect(screen.getByText('1 reply')).toBeInTheDocument();
      expect(screen.getByText('Ship it?')).toBeInTheDocument();
      expect(screen.getByText(/A: yes/)).toBeInTheDocument();
    });
    When('he taps Show earlier until it is gone', () => {
      for (let taps = 0; taps < 10; taps += 1) {
        const more = screen.queryByText(/Show earlier/);
        if (!more) break;
        fireEvent.click(more);
      }
    });
    Then('all 200 messages are on the screen', () => {
      expect(onScreen()).toHaveLength(TOTAL);
      expect(screen.getByText('Message 1')).toBeInTheDocument();
      expect(screen.queryByText(/Show earlier/)).toBeNull();
    });
  });

  Scenario('mw-q6n8m0.6 AC3: typing does not redraw a single message', ({ Given, When, Then }) => {
    Given('a General channel of 200 messages is open', open);
    When('he types a sentence into the composer', async () => {
      counts.bubbles = 0;
      counts.parsed = [];
      const box = screen.getByPlaceholderText('Message the Mayor…');
      let typed = '';
      for (const letter of 'Hello there, are you about?') {
        typed += letter;
        fireEvent.change(box, { target: { value: typed } });
      }
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(box).toHaveValue(typed);
    });
    Then('no message was redrawn', () => {
      expect(counts.bubbles).toBe(0);
      expect(counts.parsed).toEqual([]);
    });
  });
});
