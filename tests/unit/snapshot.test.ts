import { describe, it, expect, beforeEach } from 'vitest';
import { PrivateKey, Utils } from '@bsv/sdk';
import { EncryptedMessage } from 'spell-forge-bsv';
import { db } from '../../src/data/db';
import { snapshotRepo } from '../../src/data/repositories';
import { fetchSnapshot } from '../../src/services/snapshot';
import type { Snapshot } from '../../src/services/questions';

const RECIPIENT = PrivateKey.fromRandom();
const SENDER = PrivateKey.fromRandom();

const SAMPLE_SNAPSHOT: Snapshot = {
  written_at: '2026-09-24T20:00:00Z',
  epics: [
    {
      id: 'mw-f758y',
      title: 'Map',
      priority: 'P2',
      status: 'in-progress',
      needs_you: [],
      landed: [],
      working: [],
      closed_count: 0,
    },
  ],
};

function encryptSnapshot(snapshot: Snapshot): string {
  const plaintextBytes = Utils.toArray(JSON.stringify(snapshot), 'utf8');
  const encrypted = EncryptedMessage.encrypt(plaintextBytes, SENDER, RECIPIENT.toPublicKey());
  return Utils.toBase64(encrypted);
}

function fetchReturning(status: number, body: string) {
  return async () => new Response(body, { status });
}

function fetchThrowing(message: string) {
  return async () => {
    throw new Error(message);
  };
}

beforeEach(async () => {
  await db.snapshot.clear();
});

describe('fetchSnapshot', () => {
  it('fetches, decrypts and caches a fresh snapshot', async () => {
    const result = await fetchSnapshot({
      unlockedKeyHex: RECIPIENT.toHex(),
      fetchImpl: fetchReturning(200, encryptSnapshot(SAMPLE_SNAPSHOT)),
    });

    expect(result.offline).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.snapshot).toEqual(SAMPLE_SNAPSHOT);

    const cached = await snapshotRepo.get();
    expect(cached?.written_at).toBe(SAMPLE_SNAPSHOT.written_at);
  });

  it('falls back to the cached copy with an error when the fetch fails', async () => {
    await fetchSnapshot({
      unlockedKeyHex: RECIPIENT.toHex(),
      fetchImpl: fetchReturning(200, encryptSnapshot(SAMPLE_SNAPSHOT)),
    });

    const result = await fetchSnapshot({
      unlockedKeyHex: RECIPIENT.toHex(),
      fetchImpl: fetchThrowing('the network is unreachable'),
    });

    expect(result.offline).toBe(true);
    expect(result.error).toBe('the network is unreachable');
    expect(result.snapshot).toEqual(SAMPLE_SNAPSHOT);
  });

  it('falls back to the cached copy when the response is not ok', async () => {
    await fetchSnapshot({
      unlockedKeyHex: RECIPIENT.toHex(),
      fetchImpl: fetchReturning(200, encryptSnapshot(SAMPLE_SNAPSHOT)),
    });

    const result = await fetchSnapshot({
      unlockedKeyHex: RECIPIENT.toHex(),
      fetchImpl: fetchReturning(502, 'bad gateway'),
    });

    expect(result.offline).toBe(true);
    expect(result.error).toContain('502');
  });

  it('rethrows when the fetch fails and there is no cached copy', async () => {
    await expect(
      fetchSnapshot({ unlockedKeyHex: RECIPIENT.toHex(), fetchImpl: fetchThrowing('no network') }),
    ).rejects.toThrow('no network');
  });

  it('falls back to the cached copy when the key cannot decrypt the response', async () => {
    await fetchSnapshot({
      unlockedKeyHex: RECIPIENT.toHex(),
      fetchImpl: fetchReturning(200, encryptSnapshot(SAMPLE_SNAPSHOT)),
    });

    const wrongKey = PrivateKey.fromRandom();
    const result = await fetchSnapshot({
      unlockedKeyHex: wrongKey.toHex(),
      fetchImpl: fetchReturning(200, encryptSnapshot(SAMPLE_SNAPSHOT)),
    });

    expect(result.offline).toBe(true);
    expect(result.snapshot).toEqual(SAMPLE_SNAPSHOT);
  });

  it('rejects with a friendly message, not the decoder error, when the body is the SPA index.html', async () => {
    const indexHtml =
      '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="UTF-8" />\n<title>Postern</title>\n</head>\n<body>\n<div id="root"></div>\n</body>\n</html>\n';

    await expect(
      fetchSnapshot({
        unlockedKeyHex: RECIPIENT.toHex(),
        fetchImpl: fetchReturning(200, indexHtml),
      }),
    ).rejects.toThrow('No snapshot published yet.');
  });

  it('rejects with a friendly message when the body is empty', async () => {
    await expect(
      fetchSnapshot({
        unlockedKeyHex: RECIPIENT.toHex(),
        fetchImpl: fetchReturning(200, ''),
      }),
    ).rejects.toThrow('No snapshot published yet.');
  });

  it('falls back to the cached copy with the friendly message when a later fetch returns index.html', async () => {
    await fetchSnapshot({
      unlockedKeyHex: RECIPIENT.toHex(),
      fetchImpl: fetchReturning(200, encryptSnapshot(SAMPLE_SNAPSHOT)),
    });

    const result = await fetchSnapshot({
      unlockedKeyHex: RECIPIENT.toHex(),
      fetchImpl: fetchReturning(200, '<!doctype html><html><body>Not found</body></html>'),
    });

    expect(result.offline).toBe(true);
    expect(result.error).toBe('No snapshot published yet.');
    expect(result.snapshot).toEqual(SAMPLE_SNAPSHOT);
  });

  it('rethrows a 404 status message when there is no cached copy', async () => {
    await expect(
      fetchSnapshot({
        unlockedKeyHex: RECIPIENT.toHex(),
        fetchImpl: fetchReturning(404, 'not found'),
      }),
    ).rejects.toThrow('Could not fetch the snapshot (404).');
  });
});
