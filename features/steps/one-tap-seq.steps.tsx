// features/steps/one-tap-seq.steps.tsx — runs features/one-tap-seq.feature (mw-xhtcup.14): a one-tap
// action waits by event seqs when the view carries one, by the written_at clock rule when it does not.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { db } from '../../src/data/db';
import { eventsRepo, viewRepo } from '../../src/data/repositories';
import { deliverAction } from '../../src/services/deliver';
import { forgetOutboxState, settledOutbox } from '../../src/services/outbox';
import { fixtureView } from '../../tests/support/cockpit-fixture';

vi.mock('../../src/services/deliver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/deliver')>()),
  deliverAction: vi.fn(async () => ({ txid: 'direct:' + '1'.repeat(64), channel: 'direct' as const })),
}));
vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  deliverOptions: () => ({ key: new Uint8Array(32), mayorKey: '02' + '11'.repeat(32), direct: true }),
}));

const STORY = 'mw-f758y.31.2';
const TXID = 'direct:' + '1'.repeat(64);
const HOST = Date.parse('2026-10-01T12:00:00Z');

/** Stores the view the host wrote at `writtenAt` (the host's clock), with a seq or without one. */
async function storeView(writtenAt: number, seq: number | undefined, held = true): Promise<void> {
  const view = fixtureView(writtenAt);
  view.written_at = new Date(writtenAt).toISOString();
  if (seq !== undefined) view.seq = seq;
  const story = view.beads.find((b) => b.id === STORY);
  if (story && !held) story.status = 'open';
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, source: 'live', fetchedAt: writtenAt });
}

async function storeEcho(seq: number): Promise<void> {
  await eventsRepo.addNew([{ seq, ts: new Date(HOST).toISOString(), kind: 'bead_changed', bead: STORY, actor: 'governor', from: 'held', to: 'open', detail: TXID, lane: 'ordinary' }]);
}

async function tapRelease(seq: number | undefined): Promise<void> {
  await storeView(HOST, seq);
  render(<BeadScreen id={STORY} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Release' }));
  await waitFor(() => expect(deliverAction).toHaveBeenCalledTimes(1));
  await act(async () => settledOutbox());
  await waitFor(async () => expect(await db.answers.get(STORY)).toBeDefined());
}

const waits = () => expect(screen.getAllByText(/waiting for the factory/i).length).toBeGreaterThan(0);
const waitsNot = () => waitFor(() => expect(screen.queryByText(/waiting for the factory/i)).toBeNull());

afterAll(() => cleanup());

const feature = await loadFeature('features/one-tap-seq.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    vi.mocked(deliverAction).mockClear();
    forgetTaps();
    forgetOutboxState();
    await Promise.all([db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear(), db.outbox.clear(), db.events.clear()]);
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  AfterEachScenario(() => {
    cleanup();
    forgetOutboxState();
    vi.useRealTimers();
  });

  Scenario("mw-xhtcup.14 AC-1: a slow phone clock does not offer a tapped Release again", ({ Given, And, When, Then }) => {
    Given("the phone's clock is 10 minutes slow", async () => {
      vi.setSystemTime(HOST - 10 * 60_000);
    });
    And('he taps Release on a held story against a view of seq 10', () => tapRelease(10));
    When('a view of seq 11 without the echo arrives', async () => {
      await act(async () => {
        await storeView(HOST + 30_000, 11);
      });
      await act(async () => {});
    });
    Then('the Release button stays gone and the card says it is waiting', async () => {
      expect(screen.queryByRole('button', { name: 'Release' })).toBeNull();
      waits();
    });
    When('the echo event of seq 12 is stored and a view of seq 12 with the story released arrives', async () => {
      await act(async () => {
        await storeEcho(12);
        await storeView(HOST + 60_000, 12, false);
      });
    });
    Then('the card no longer waits and Release is not offered', async () => {
      await waitsNot();
      expect(screen.queryByRole('button', { name: 'Release' })).toBeNull();
    });
  });

  Scenario("mw-xhtcup.14 AC-2: a fast phone clock does not hide a view that has seen the tap", ({ Given, And, When, Then }) => {
    Given("the phone's clock is 10 minutes fast", async () => {
      vi.setSystemTime(HOST + 10 * 60_000);
    });
    And('he taps Release on a held story against a view of seq 10', () => tapRelease(10));
    When('the echo event of seq 12 is stored and a view of seq 12 arrives that still holds the story', async () => {
      await act(async () => {
        await storeEcho(12);
        await storeView(HOST + 60_000, 12);
      });
    });
    Then('the card no longer says it is waiting', () => waitsNot());
    And('Release is offered again', async () => {
      expect(screen.getByRole('button', { name: 'Release' })).toBeInTheDocument();
    });
  });

  Scenario('mw-xhtcup.14 AC-3: a view with no seq is judged by its written_at as before', ({ Given, And, When, Then }) => {
    Given("the phone's clock is right", async () => {
      vi.setSystemTime(HOST + 60_000);
    });
    And('he taps Release on a held story against a view with no seq', () => tapRelease(undefined));
    Then('the card says it is waiting', async () => waits());
    When('a view with no seq written after the tap arrives', async () => {
      await act(async () => {
        await storeView(HOST + 5 * 60_000, undefined);
      });
    });
    Then('the card no longer says it is waiting', () => waitsNot());
  });
});
