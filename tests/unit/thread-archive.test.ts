// mw-2y46l.6: which threads Talk files under Archived, and where his hand-made
// choices are kept.
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type MessageRow } from '../../src/data/db';
import { settingsRepo } from '../../src/data/repositories';
import { AUTO_ARCHIVE_AFTER_MS, GENERAL, summariseThreads } from '../../src/model/threads';
import { indexView } from '../../src/model/tree';
import { fixtureView } from '../support/cockpit-fixture';
import type { ViewBead } from '../../src/model/view';

const NOW = Date.UTC(2026, 8, 29, 12);
const DAY = 86_400_000;

function bead(id: string, status: string): ViewBead {
  return { ...fixtureView(NOW).beads[0], id, title: id, status, parent: undefined };
}

function said(thread: string | undefined, ageMs: number): MessageRow {
  return {
    id: `${thread ?? 'general'}:${ageMs}:0`,
    txid: `${thread ?? 'general'}:${ageMs}`,
    vout: 0,
    seq: 1,
    class: 'message',
    to: '',
    from: '',
    ts: Math.floor((NOW - ageMs) / 1000),
    ciphertext: '',
    direction: 'received',
    read: true,
    thread,
  };
}

const view = (...beads: ViewBead[]) => indexView({ ...fixtureView(NOW), beads });
const archivedKeys = (threads: { key: string; archived: boolean }[]) => threads.filter((t) => t.archived).map((t) => t.key);

describe('summariseThreads: auto-archive', () => {
  it('archives a closed bead quiet for over 3 days, not one quiet for 1 day', () => {
    const index = view(bead('a', 'closed'), bead('b', 'closed'));
    const threads = summariseThreads([said('bead:a', 4 * DAY), said('bead:b', 1 * DAY)], index, {}, NOW);
    expect(archivedKeys(threads)).toEqual(['bead:a']);
  });

  it('draws the line at 3 days', () => {
    const index = view(bead('a', 'closed'));
    expect(archivedKeys(summariseThreads([said('bead:a', AUTO_ARCHIVE_AFTER_MS)], index, {}, NOW))).toEqual([]);
    expect(archivedKeys(summariseThreads([said('bead:a', AUTO_ARCHIVE_AFTER_MS + 1000)], index, {}, NOW))).toEqual(['bead:a']);
  });

  it('archives a bead the view does not list, but only once a view is loaded', () => {
    const messages = [said('bead:gone', 5 * DAY)];
    expect(archivedKeys(summariseThreads(messages, view(bead('other', 'open')), {}, NOW))).toEqual(['bead:gone']);
    expect(archivedKeys(summariseThreads(messages, undefined, {}, NOW))).toEqual([]);
  });

  it('never auto-archives an open bead, a topic or Factory', () => {
    const index = view(bead('a', 'open'));
    const messages = [said('bead:a', 30 * DAY), said('topic:desktop move', 30 * DAY), said(undefined, 30 * DAY)];
    expect(archivedKeys(summariseThreads(messages, index, {}, NOW))).toEqual([]);
  });
});

describe('summariseThreads: his choices', () => {
  it('archives any thread he archived, and a newer message brings it back', () => {
    const index = view(bead('a', 'open'));
    const choices = { 'bead:a': { archived: true, at: NOW - DAY / 2 } };
    expect(archivedKeys(summariseThreads([said('bead:a', DAY)], index, choices, NOW))).toEqual(['bead:a']);
    expect(archivedKeys(summariseThreads([said('bead:a', DAY), said('bead:a', DAY / 4)], index, choices, NOW))).toEqual([]);
  });

  it('lets him bring back an auto-archived thread until something newer is said', () => {
    const index = view(bead('a', 'closed'));
    const choices = { 'bead:a': { archived: false, at: NOW - DAY / 2 } };
    expect(archivedKeys(summariseThreads([said('bead:a', 5 * DAY)], index, choices, NOW))).toEqual([]);
  });

  it('never archives Factory, even by hand', () => {
    const choices = { [GENERAL]: { archived: true, at: NOW } };
    expect(archivedKeys(summariseThreads([said(undefined, DAY)], undefined, choices, NOW))).toEqual([]);
  });
});

describe('settingsRepo thread archive choices', () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  it('starts empty, remembers archive and unarchive, per thread', async () => {
    expect(await settingsRepo.getThreadArchive()).toEqual({});
    await settingsRepo.setThreadArchived('bead:a', true);
    await settingsRepo.setThreadArchived('bead:b', false);
    const stored = await settingsRepo.getThreadArchive();
    expect(stored['bead:a']).toMatchObject({ archived: true });
    expect(stored['bead:b']).toMatchObject({ archived: false });
    expect(stored['bead:a'].at).toBeGreaterThan(0);
  });
});
