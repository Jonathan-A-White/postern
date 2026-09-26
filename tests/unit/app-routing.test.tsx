// tests/unit/app-routing.test.tsx — mw-tfne4.28: a `?screen=` link click must not
// be a page load, or the shared key session (services/keySession.ts, mw-tfne4.23)
// never survives to the next screen. Renders <App/> once and clicks real anchors,
// unlike features/steps/projects.steps.tsx's `window.history.pushState` + fresh
// `render(<App/>)` pattern, which only proves a fresh mount reuses the module-level
// session — not that a real link click does.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { PrivateKey, PublicKey, Utils } from '@bsv/sdk';
import { EncryptedMessage } from 'spell-forge-bsv';
import { App } from '../../src/App';
import { db } from '../../src/data/db';
import { vaultRepo } from '../../src/data/repositories';
import { createMnemonic, deriveMasterKey, publicKeyHexFromMasterKey } from '../../src/services/vault';
import { getKey, setKey, lock } from '../../src/services/keySession';
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

const SNAPSHOT: Snapshot = {
  written_at: new Date().toISOString(),
  epics: [
    {
      id: 'mw-alpha',
      title: 'Alpha project',
      priority: 'P0',
      status: 'in-progress',
      needs_you: [],
      landed: [{ id: 'mw-alpha.1', title: 'Landed thing', landed_at: '2026-09-24T10:00:00Z' }],
      working: [],
      closed_count: 0,
    },
  ],
};

/** Saves a real vault and unlocks it directly with setKey (skipping the unlock UI
 * entirely, as an already-shared session would), with a snapshot fetch stubbed so
 * the epic and bead links this suite clicks actually render. */
async function unlockedProjectsScreen(): Promise<Uint8Array> {
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
  vi.stubGlobal('fetch', snapshotFetchMock(encryptSnapshot(SNAPSHOT, publicKeyHex)));
  setKey(masterKey);
  window.history.pushState({}, '', '/?screen=projects');
  render(<App />);
  return masterKey;
}

describe('App routing between screens (mw-tfne4.28)', () => {
  afterEach(async () => {
    cleanup();
    lock();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
    await db.vault.clear();
    await db.snapshot.clear();
  });

  it('AC1: clicking a ?screen= link changes the URL without a page load and keeps the shared key session, across two hops', async () => {
    const masterKey = await unlockedProjectsScreen();
    const beforeUnload = vi.fn();
    window.addEventListener('beforeunload', beforeUnload);

    const epicLink = await screen.findByRole('link', { name: /Alpha project/ });
    const firstClickDefaultRan = fireEvent.click(epicLink);

    expect(firstClickDefaultRan).toBe(false); // the anchor's default navigation was prevented
    expect(window.location.search).toBe('?screen=project&epic=mw-alpha');
    expect(getKey()).toEqual(masterKey); // still shared: no page load reset the module session
    expect(beforeUnload).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'Alpha project' })).toBeInTheDocument();

    const beadLink = await screen.findByRole('link', { name: /Landed thing/ });
    const secondClickDefaultRan = fireEvent.click(beadLink);

    expect(secondClickDefaultRan).toBe(false);
    expect(window.location.search).toBe('?screen=bead&epic=mw-alpha&kind=landed&bead=mw-alpha.1');
    expect(getKey()).toEqual(masterKey);
    expect(beforeUnload).not.toHaveBeenCalled();
    expect(await screen.findByText('Landed thing')).toBeInTheDocument();
  });

  it('AC2: the browser Back button re-renders the previous screen from the URL without a page load', async () => {
    const masterKey = await unlockedProjectsScreen();

    const epicLink = await screen.findByRole('link', { name: /Alpha project/ });
    fireEvent.click(epicLink);
    await screen.findByRole('heading', { name: 'Alpha project' });
    expect(window.location.search).toBe('?screen=project&epic=mw-alpha');

    window.history.back();

    await waitFor(() => expect(window.location.search).toBe('?screen=projects'));
    expect(await screen.findByRole('link', { name: /Alpha project/ })).toBeInTheDocument();
    expect(getKey()).toEqual(masterKey);
  });
});
