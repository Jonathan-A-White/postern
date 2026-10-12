// tests/unit/ideas-only-event.test.ts — mw-8ifimx.3 AC-4: the stream's ideas-only event (§10, §25) for
// my key updates the kept state; one for another key changes nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/data/db';
import { settingsRepo } from '../../src/data/repositories';
import { applyIdeasOnlyEvent } from '../../src/services/ideasOnly';
import type { IdeasOnlyKept } from '../../src/model/ideasOnly';

const ME = '02' + '11'.repeat(32);
const OTHER = '03' + '22'.repeat(32);

const kept: IdeasOnlyKept = {
  key: ME,
  setting: { until: 1_790_000_000, reaches: { ring: false } },
  state: { on: true, until: 1_790_000_000, by: 'until' },
  at: 5,
};

const net = vi.hoisted(() => ({ stream: undefined as ReadableStreamDefaultController<Uint8Array> | undefined }));

const event = (key: string, on: boolean, until: number): string => JSON.stringify({ key, on, until });

beforeEach(async () => {
  await db.settings.clear();
});

describe('applyIdeasOnlyEvent', () => {
  it('turns the kept state on, with the new end, for my key', async () => {
    expect(await applyIdeasOnlyEvent(ME, event(ME, true, 1_790_003_600))).toBe(true);
    const now = await settingsRepo.getIdeasOnly();
    expect(now?.state).toEqual({ on: true, until: 1_790_003_600, by: 'until' });
  });

  it('turns it off, and keeps the setting the phone knew', async () => {
    await settingsRepo.setIdeasOnly(kept);
    expect(await applyIdeasOnlyEvent(ME, event(ME, false, 0))).toBe(true);
    const now = await settingsRepo.getIdeasOnly();
    expect(now?.state).toEqual({ on: false, until: 0, by: '' });
    expect(now?.setting).toEqual(kept.setting);
  });

  it('moves the end of a mode that was on and keeps who set it', async () => {
    await settingsRepo.setIdeasOnly({ ...kept, state: { on: true, until: 1_790_000_000, by: 'schedule' } });
    await applyIdeasOnlyEvent(ME, event(ME, true, 1_790_007_200));
    expect((await settingsRepo.getIdeasOnly())?.state).toEqual({ on: true, until: 1_790_007_200, by: 'schedule' });
  });

  it('changes nothing for another key', async () => {
    await settingsRepo.setIdeasOnly(kept);
    expect(await applyIdeasOnlyEvent(ME, event(OTHER, false, 0))).toBe(false);
    expect(await settingsRepo.getIdeasOnly()).toEqual(kept);
  });

  it('keeps nothing for another key when nothing was kept', async () => {
    expect(await applyIdeasOnlyEvent(ME, event(OTHER, true, 1_790_003_600))).toBe(false);
    expect(await settingsRepo.getIdeasOnly()).toBeUndefined();
  });

  it('ignores an event that is not one', async () => {
    expect(await applyIdeasOnlyEvent(ME, 'not json')).toBe(false);
    expect(await applyIdeasOnlyEvent(ME, JSON.stringify({ key: ME }))).toBe(false);
    expect(await settingsRepo.getIdeasOnly()).toBeUndefined();
  });
});

// The same, through the real stream reader in src/services/live.ts.
describe('the event stream', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('../../src/services/apiAuth', () => ({
      apiFetch: vi.fn(async (path: string) => {
        if (path === '/events') {
          return {
            ok: true,
            status: 200,
            body: new ReadableStream<Uint8Array>({
              start(controller) {
                net.stream = controller;
              },
            }),
          };
        }
        throw new TypeError('Failed to fetch'); // the exact-state ask after the event: no network
      }),
    }));
    vi.doMock('../../src/services/events', () => ({ syncMessagesAndEvents: vi.fn(async () => ({ applied: 0, refetched: false })) }));
    vi.doMock('../../src/services/view', () => ({ refreshView: vi.fn(async () => 'unchanged') }));
    vi.doMock('../../src/services/me', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../src/services/me')>()),
      fetchMe: vi.fn(async () => ({ pubkey: '', mayor: '', network: 'testnet', features: ['events', 'view'] })),
      reconcileMayorKey: vi.fn(async () => ({ pinned: undefined, offered: undefined })),
    }));
    vi.doMock('../../src/services/vault', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../src/services/vault')>()),
      publicKeyHexFromMasterKey: () => ME,
    }));
  });

  afterEach(() => {
    vi.doUnmock('../../src/services/apiAuth');
    vi.doUnmock('../../src/services/events');
    vi.doUnmock('../../src/services/view');
    vi.doUnmock('../../src/services/me');
    vi.doUnmock('../../src/services/vault');
  });

  it('keeps the state of my key from an ideas-only event and nothing from another key', async () => {
    const { startLive, stopLive } = await import('../../src/services/live');
    const { settingsRepo: repo } = await import('../../src/data/repositories');
    startLive(new Uint8Array(32).fill(9));
    await vi.waitFor(() => expect(net.stream).toBeDefined());
    const say = (data: string) => net.stream?.enqueue(new TextEncoder().encode(`event: ideas-only\ndata: ${data}\n\n`));
    say(event(OTHER, true, 1_790_003_600));
    say(event(ME, true, 1_790_003_600));
    await vi.waitFor(async () => expect((await repo.getIdeasOnly())?.state.until).toBe(1_790_003_600));
    expect((await repo.getIdeasOnly())?.key).toBe(ME);
    stopLive();
  });
});
