// features/steps/search-bead-id.steps.tsx — runs features/search-bead-id.feature:
// Search offers a bead by its id even when the phone's view lacks it (mw-t64a3.15).
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, expect, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PrivateKey, Utils } from '@bsv/sdk';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { SearchScreen } from '../../src/cockpit/SearchScreen';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { lock, setKey } from '../../src/services/keySession';
import { sealDocument } from '../../src/services/documents';
import { parseRoute } from '../../src/nav/route';
import { fixtureDetail, fixtureView, MAYOR } from '../../tests/support/cockpit-fixture';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

const feature = await loadFeature('features/search-bead-id.feature');

const GOV = PrivateKey.fromHex('45'.repeat(32));

afterAll(() => {
  cleanup();
  lock();
  vi.unstubAllGlobals();
});

async function phoneWithView(): Promise<void> {
  cleanup();
  await Promise.all([db.view.clear(), db.beadDetails.clear(), db.messages.clear(), db.settings.clear()]);
  const view = fixtureView();
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, source: 'live', fetchedAt: Date.now() });
  setKey(new Uint8Array(Utils.toArray(GOV.toHex(), 'hex')));
  window.history.replaceState(null, '', '/?v=search');
}

function backend(answer: (id: string) => Promise<Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return isChallengeRequest(url) ? challengeResponse() : answer(decodeURIComponent(url.split('/beads/')[1] ?? ''));
    }),
  );
}

describeFeature(feature, ({ Scenario }) => {
  Scenario('mw-t64a3.15: an id the view holds ranks that bead first, however it is typed', ({ Given, When, Then }) => {
    Given('the view holds the bead "mw-2rbm.10"', phoneWithView);
    When('" MW-2RBM.10 -" is typed into Search', () => {
      render(<SearchScreen q=" MW-2RBM.10 -" />);
    });
    Then('the bead "mw-2rbm.10" is the first hit', async () => {
      const first = within(await screen.findByTestId('hits-bead')).getAllByRole('link')[0];
      expect(first).toHaveAttribute('href', expect.stringContaining('mw-2rbm.10'));
    });
  });

  Scenario('mw-t64a3.15: an id the view lacks is offered, fetched and opened', ({ Given, When, Then }) => {
    Given('the view does not hold the bead "mw-eq5nn.4" but the backend does', async () => {
      await phoneWithView();
      const sealed = await sealDocument(JSON.stringify({ ...fixtureDetail('mw-f758y.30.2')!, id: 'mw-eq5nn.4' }), MAYOR.toHex(), GOV.toPublicKey().toString());
      backend(async () => new Response(sealed, { status: 200 }));
    });
    When('"mw-eq5nn.4" is typed into Search and Open is tapped', async () => {
      render(<SearchScreen q="mw-eq5nn.4" />);
      await userEvent.click(await screen.findByRole('button', { name: 'Open mw-eq5nn.4' }));
    });
    Then('the bead screen for "mw-eq5nn.4" is opened', async () => {
      await waitFor(() => expect(parseRoute(window.location.search)).toEqual({ view: 'bead', id: 'mw-eq5nn.4' }));
    });
  });

  Scenario('mw-t64a3.15: an id nobody knows says there is no such bead', ({ Given, When, Then }) => {
    Given('neither the view nor the backend holds the bead "mw-nope.9"', async () => {
      await phoneWithView();
      backend(async () => new Response(JSON.stringify({ error: 'no such bead' }), { status: 404, headers: { 'Content-Type': 'application/json' } }));
    });
    When('"mw-nope.9" is typed into Search and Open is tapped', async () => {
      render(<SearchScreen q="mw-nope.9" />);
      await userEvent.click(await screen.findByRole('button', { name: 'Open mw-nope.9' }));
    });
    Then('Search says "no bead mw-nope.9"', async () => {
      expect(await screen.findByText('no bead mw-nope.9')).toBeInTheDocument();
    });
  });
});
