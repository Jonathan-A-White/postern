// features/steps/api-signature-v2.steps.ts — runs features/api-signature-v2.feature:
// apiFetch (src/services/apiAuth.ts) signs the whole request (mw-xhtcup.8).
import { expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey, Utils } from '@bsv/sdk';
import { apiFetch } from '../../src/services/apiAuth';
import { challengeResponse, isChallengeRequest, receivedRequest, verifiesV2, type ReceivedRequest } from '../../tests/support/challenge-fetch';

const KEY = new Uint8Array(Utils.toArray(PrivateKey.fromHex('33'.repeat(32)).toHex(), 'hex'));

let fetchImpl: typeof fetch;
let received: { header: string | null; request: ReceivedRequest } | undefined;

const feature = await loadFeature('features/api-signature-v2.feature');

describeFeature(feature, ({ Scenario }) => {
  const backend = () => {
    received = undefined;
    fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (isChallengeRequest(String(input))) return challengeResponse();
      received = { header: new Headers(init?.headers).get('Authorization'), request: receivedRequest(input, init) };
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
  };
  const postMessage = async () => {
    await apiFetch('/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scriptHex: 'ab12' }) }, { unlockedKey: KEY, fetchImpl });
  };

  Scenario('mw-xhtcup.8 AC1: a message post is signed over its method, target and body', ({ Given, When, Then }) => {
    Given('a backend that checks the Postern2 signature of what it receives', backend);
    When('the app posts a JSON message with his key', postMessage);
    Then('the backend verifies the header over exactly that method, target and body', async () => {
      expect(received?.request).toEqual({ method: 'POST', target: '/api/messages', body: new TextEncoder().encode('{"scriptHex":"ab12"}') });
      expect(await verifiesV2(received!.header, received!.request)).toBe(true);
    });
  });

  Scenario('mw-xhtcup.8 AC2: the event stream is signed over a GET with no body', ({ Given, When, Then }) => {
    Given('a backend that checks the Postern2 signature of what it receives', backend);
    When('the app opens the event stream with his key', async () => {
      await apiFetch('/events', { headers: { Accept: 'text/event-stream' } }, { unlockedKey: KEY, fetchImpl });
    });
    Then('the backend verifies the header over a GET of the stream with an empty body', async () => {
      expect(received?.request).toEqual({ method: 'GET', target: '/api/events', body: new Uint8Array(0) });
      expect(await verifiesV2(received!.header, received!.request)).toBe(true);
    });
  });

  Scenario('mw-xhtcup.8 AC3: a header moved to another body or target is refused', ({ Given, When, Then, And }) => {
    Given('a backend that checks the Postern2 signature of what it receives', backend);
    When('the app posts a JSON message with his key', postMessage);
    Then('the same header is refused for a changed body', async () => {
      expect(await verifiesV2(received!.header, { ...received!.request, body: new TextEncoder().encode('{"scriptHex":"ab13"}') })).toBe(false);
    });
    And('the same header is refused for a changed target', async () => {
      expect(await verifiesV2(received!.header, { ...received!.request, target: '/api/blobs' })).toBe(false);
    });
  });
});
