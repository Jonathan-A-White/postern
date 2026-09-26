// tests/unit/bead-screen.test.tsx — mw-hy6f4.4: the Bead screen renders a
// working/landed/needs-you item's optional description and comments (added to
// the snapshot by mw-hy6f4.3) through the shared Markdown component, and falls
// back to today's plain screen when a fixture carries neither field.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { PrivateKey, PublicKey, Utils } from '@bsv/sdk';
import { EncryptedMessage } from 'spell-forge-bsv';
import { BeadScreen } from '../../src/projects/BeadScreen';
import { db } from '../../src/data/db';
import { vaultRepo } from '../../src/data/repositories';
import { createMnemonic, deriveMasterKey, publicKeyHexFromMasterKey } from '../../src/services/vault';
import { setKey, lock } from '../../src/services/keySession';
import type { Snapshot } from '../../src/services/questions';

const MAYOR_KEY = PrivateKey.fromHex('66'.repeat(32));

function encryptSnapshot(snapshot: Snapshot, recipientPublicKeyHex: string): string {
  const plaintextBytes = Utils.toArray(JSON.stringify(snapshot), 'utf8');
  const encrypted = EncryptedMessage.encrypt(plaintextBytes, MAYOR_KEY, PublicKey.fromString(recipientPublicKeyHex));
  return Utils.toBase64(encrypted);
}

function snapshotFetchMock(base64: string) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.endsWith('/snapshot')) throw new Error(`unexpected fetch: ${url}`);
    return new Response(base64, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  });
}

/** Saves a real vault and unlocks it directly with setKey (skipping the unlock
 * UI, as an already-shared session would), with the given snapshot's fetch
 * stubbed so the Bead screen has something to read. */
async function renderBeadScreenWithSnapshot(snapshot: Snapshot): Promise<void> {
  const masterKey = await deriveMasterKey(createMnemonic());
  const publicKeyHex = publicKeyHexFromMasterKey(masterKey);
  await vaultRepo.save({
    mode: 'phrase',
    ciphertext: new Uint8Array([1]).buffer,
    iv: new Uint8Array(12),
    salt: new Uint8Array(16),
    prfFallbackReason: 'webauthn-unavailable',
    publicKeyHex,
  });
  vi.stubGlobal('fetch', snapshotFetchMock(encryptSnapshot(snapshot, publicKeyHex)));
  setKey(masterKey);
  render(<BeadScreen epicId="mw-epic" kind="working" beadId="mw-epic.w1" />);
}

function snapshotWithWorkingItem(overrides: Partial<Snapshot['epics'][0]['working'][0]>): Snapshot {
  return {
    written_at: new Date().toISOString(),
    epics: [
      {
        id: 'mw-epic',
        title: 'The epic',
        priority: 'P1',
        status: 'in-progress',
        needs_you: [],
        landed: [],
        working: [
          {
            id: 'mw-epic.w1',
            title: 'Working thing',
            status: 'in-progress',
            priority: 'P1',
            updated_at: '2026-09-26T09:00:00Z',
            waits: [],
            ...overrides,
          },
        ],
        closed_count: 0,
      },
    ],
  };
}

describe('BeadScreen: description and comments (mw-hy6f4.4)', () => {
  afterEach(async () => {
    cleanup();
    lock();
    vi.unstubAllGlobals();
    await db.vault.clear();
    await db.snapshot.clear();
  });

  it('AC1: shows the description formatted through Markdown and its comments newest first', async () => {
    const snapshot = snapshotWithWorkingItem({
      description: '## Plan\n\nDo the thing.',
      comments: [
        { at: '2026-09-26T10:00:00Z', text: 'Newest comment' },
        { at: '2026-09-26T09:00:00Z', text: 'Middle comment' },
        { at: '2026-09-26T08:00:00Z', text: 'Oldest comment' },
      ],
    });

    await renderBeadScreenWithSnapshot(snapshot);

    expect(await screen.findByRole('heading', { level: 2, name: 'Plan' })).toBeInTheDocument();
    expect(screen.getByText('Do the thing.')).toBeInTheDocument();

    const comments = screen.getAllByTestId('bead-comment');
    expect(comments).toHaveLength(3);
    expect(within(comments[0]).getByText('Newest comment')).toBeInTheDocument();
    expect(within(comments[1]).getByText('Middle comment')).toBeInTheDocument();
    expect(within(comments[2]).getByText('Oldest comment')).toBeInTheDocument();
    expect(within(comments[0]).getByText(new Date('2026-09-26T10:00:00Z').toLocaleString())).toBeInTheDocument();
  });

  it('AC2: renders exactly as before when description and comments are absent', async () => {
    const snapshot = snapshotWithWorkingItem({});

    await renderBeadScreenWithSnapshot(snapshot);

    expect(await screen.findByText('Working thing')).toBeInTheDocument();
    expect(screen.queryByTestId('bead-comment')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bead-description')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('undefined');
  });
});
