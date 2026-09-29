// tests/unit/search-bead-id.test.tsx — mw-t64a3.15: typing a bead id into Search
// always offers that bead, even when the phone's copy of the view does not hold
// it: "Open <id>" fetches the bead endpoint (docs/protocol.md §12) and opens the
// bead screen; an id the backend does not know says "no bead <id>".
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PrivateKey, Utils } from '@bsv/sdk';
import { SearchScreen } from '../../src/cockpit/SearchScreen';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { lock, setKey } from '../../src/services/keySession';
import { sealDocument } from '../../src/services/documents';
import { parseRoute } from '../../src/nav/route';
import { fixtureDetail, fixtureView, MAYOR } from '../support/cockpit-fixture';
import { challengeResponse, isChallengeRequest } from '../support/challenge-fetch';

const GOV = PrivateKey.fromHex('45'.repeat(32));
const GOV_KEY = new Uint8Array(Utils.toArray(GOV.toHex(), 'hex'));
const IN_VIEW = 'mw-f758y.30.2';
const ABSENT = 'mw-eq5nn.4';

function stubBackend(handler: (id: string) => Promise<Response>) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (isChallengeRequest(url)) return challengeResponse();
    const id = decodeURIComponent(url.split('/beads/')[1] ?? '');
    return handler(id);
  });
  vi.stubGlobal('fetch', fetchImpl);
  return fetchImpl;
}

function beadCalls(fetchImpl: ReturnType<typeof stubBackend>): string[] {
  return fetchImpl.mock.calls.map(([input]) => String(input)).filter((url) => url.includes('/beads/'));
}

describe('Search offers a bead by its id even when the view does not hold it', () => {
  beforeEach(async () => {
    await Promise.all([db.view.clear(), db.beadDetails.clear(), db.messages.clear(), db.settings.clear()]);
    const view = fixtureView();
    await viewRepo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, source: 'live', fetchedAt: Date.now() });
    setKey(GOV_KEY);
    window.history.replaceState(null, '', '/?v=search');
  });
  afterEach(() => {
    cleanup();
    lock();
    vi.unstubAllGlobals();
  });
  afterAll(() => cleanup());

  it('offers no Open button when the view holds the id: the bead is the first hit', async () => {
    const fetchImpl = stubBackend(async () => new Response('', { status: 500 }));
    render(<SearchScreen q={` ${IN_VIEW.toUpperCase()} - `} />);
    const first = within(await screen.findByTestId('hits-bead')).getAllByRole('link')[0];
    expect(first).toHaveAttribute('href', expect.stringContaining(IN_VIEW));
    expect(screen.queryByRole('button', { name: `Open ${IN_VIEW}` })).toBeNull();
    expect(beadCalls(fetchImpl)).toEqual([]);
  });

  it('offers Open for an id the view lacks, fetches the bead endpoint and opens the bead screen', async () => {
    const detail = fixtureDetail(IN_VIEW)!;
    const sealed = await sealDocument(JSON.stringify({ ...detail, id: ABSENT, title: 'Search should help me find beads' }), MAYOR.toHex(), GOV.toPublicKey().toString());
    const fetchImpl = stubBackend(async () => new Response(sealed, { status: 200 }));
    render(<SearchScreen q={`MW-EQ5NN.4 -`} />);
    await userEvent.click(await screen.findByRole('button', { name: `Open ${ABSENT}` }));
    await waitFor(() => expect(parseRoute(window.location.search)).toEqual({ view: 'bead', id: ABSENT }));
    expect(beadCalls(fetchImpl)).toEqual([`/api/beads/${ABSENT}`]);
    expect(screen.queryByText(`no bead ${ABSENT}`)).toBeNull();
  });

  it('says "no bead <id>" for an id the backend does not know, and stays on Search', async () => {
    stubBackend(async () => new Response(JSON.stringify({ error: 'no such bead' }), { status: 404, headers: { 'Content-Type': 'application/json' } }));
    render(<SearchScreen q="mw-nope.9" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Open mw-nope.9' }));
    expect(await screen.findByText('no bead mw-nope.9')).toBeInTheDocument();
    expect(parseRoute(window.location.search)).toEqual({ view: 'search' });
  });
});
