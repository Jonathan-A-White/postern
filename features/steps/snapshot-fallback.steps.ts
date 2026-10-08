// features/steps/snapshot-fallback.steps.ts — runs features/snapshot-fallback.feature
// (mw-44omaq.1): refreshView against a backend with no /api/view and a /snapshot that
// answers a sealed snapshot, an HTML page or nothing.
import { expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey, PublicKey, Utils } from '@bsv/sdk';
import { EncryptedMessage } from 'spell-forge-bsv';
import { refreshView, storedView, type ViewRefresh } from '../../src/services/view';
import { db } from '../../src/data/db';
import { MAYOR } from '../../tests/support/cockpit-fixture';

const feature = await loadFeature('features/snapshot-fallback.feature');

const GOV = PrivateKey.fromHex('45'.repeat(32));
const GOV_KEY = new Uint8Array(Utils.toArray(GOV.toHex(), 'hex'));
const GOV_PUB = GOV.toPublicKey().toString();
const INDEX_HTML = '<!doctype html>\n<html lang="en">\n<head><title>Postern</title></head>\n<body><div id="root"></div></body>\n</html>\n';

function sealedSnapshot(): string {
  const snapshot = { written_at: 'w', epics: [{ id: 'e', title: 'E', priority: 'P2', status: 'open', needs_you: [], landed: [], working: [], closed_count: 0 }] };
  return Utils.toBase64(EncryptedMessage.encrypt(Utils.toArray(JSON.stringify(snapshot), 'utf8'), MAYOR, PublicKey.fromString(GOV_PUB)));
}

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  let fetchImpl: typeof fetch;
  let result: ViewRefresh;

  BeforeEachScenario(async () => {
    await db.view.clear();
  });

  function backendAnswering(snapshotBody: string): typeof fetch {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/challenge')) return new Response(JSON.stringify({ nonce: 'ab'.repeat(32) }), { status: 200 });
      if (url.endsWith('/view')) return new Response('404 page not found', { status: 404 });
      return new Response(snapshotBody, { status: 200 });
    }) as unknown as typeof fetch;
  }

  function refresh() {
    return async () => {
      result = await refreshView({ key: GOV_KEY, live: true, fetchImpl, snapshotUrl: '/snapshot' });
    };
  }

  function absentAndNothingSaved() {
    return async () => {
      expect(result).toBe('absent');
      expect(await db.view.count()).toBe(0);
    };
  }

  Scenario('mw-44omaq.1: a /snapshot body that is an HTML page is absent, not a decoder error', ({ Given, When, Then }) => {
    Given("the backend has no live view and answers /snapshot with the SPA's index.html", () => {
      fetchImpl = backendAnswering(INDEX_HTML);
    });
    When('the phone refreshes the view', refresh());
    Then('the view is reported absent and nothing is saved', absentAndNothingSaved());
  });

  Scenario('mw-44omaq.1: an empty /snapshot body is absent, not a decoder error', ({ Given, When, Then }) => {
    Given('the backend has no live view and answers /snapshot with an empty body', () => {
      fetchImpl = backendAnswering('');
    });
    When('the phone refreshes the view', refresh());
    Then('the view is reported absent and nothing is saved', absentAndNothingSaved());
  });

  Scenario('mw-44omaq.1: a sealed snapshot at /snapshot is still read', ({ Given, When, Then }) => {
    Given('the backend has no live view and answers /snapshot with a sealed snapshot', () => {
      fetchImpl = backendAnswering(sealedSnapshot());
    });
    When('the phone refreshes the view', refresh());
    Then('the view is updated from the snapshot', async () => {
      expect(result).toBe('updated');
      expect((await storedView())?.source).toBe('snapshot');
    });
  });
});

