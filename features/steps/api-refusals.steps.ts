// features/steps/api-refusals.steps.ts — runs features/api-refusals.feature:
// what apiFetch (src/services/apiAuth.ts) says when the backend refuses a
// signed call (mw-t64a3.25).
import { expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey, Utils } from '@bsv/sdk';
import { apiFetch } from '../../src/services/apiAuth';

const KEY = new Uint8Array(Utils.toArray(PrivateKey.fromHex('22'.repeat(32)).toHex(), 'hex'));

let fetchImpl: ReturnType<typeof vi.fn>;
let result: { response?: Response; error?: Error };
let challenges: number;
let posts: number;

const refusal = (reason: string) => new Response(JSON.stringify({ error: 'refused', reason }), { status: 401 });

function backend(answer: (post: number) => Response, challenge?: () => Response) {
  challenges = 0;
  posts = 0;
  fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/challenge')) {
      challenges += 1;
      return challenge ? challenge() : new Response(JSON.stringify({ nonce: String(challenges).repeat(64) }), { status: 200 });
    }
    posts += 1;
    return answer(posts);
  });
}

const call = async () => {
  result = {};
  try {
    result.response = await apiFetch('/messages', { method: 'POST', body: '{}' }, { unlockedKey: KEY, fetchImpl: fetchImpl as unknown as typeof fetch });
  } catch (err) {
    result.error = err as Error;
  }
};

const feature = await loadFeature('features/api-refusals.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('mw-t64a3.25 AC1: a nonce refusal is retried once with a fresh challenge', ({ Given, When, Then }) => {
    Given("a backend that refuses the first signed call's nonce", () => {
      backend((post) => (post === 1 ? refusal('nonce') : new Response('{}', { status: 200 })));
    });
    When('a signed call is made with his key', call);
    Then('the call succeeds on its second try with a fresh challenge', () => {
      expect(result.error).toBeUndefined();
      expect(result.response?.status).toBe(200);
      expect(posts).toBe(2);
      expect(challenges).toBe(2);
    });
  });

  Scenario('mw-t64a3.25 AC2: a 401 that says no licence is held is "Licence required"', ({ Given, When, Then }) => {
    Given('a backend that says no licence is held', () => {
      backend(() => refusal('no_licence'));
    });
    When('a signed call is made with his key', call);
    Then('the call fails with "Licence required"', () => {
      expect(result.error?.message).toBe('Licence required');
    });
  });

  Scenario('mw-t64a3.25 AC2: two nonce refusals in a row do not blame the licence', ({ Given, When, Then, And }) => {
    Given('a backend that refuses every nonce', () => {
      backend(() => refusal('nonce'));
    });
    When('a signed call is made with his key', call);
    Then('the call fails with a message that does not mention a licence', () => {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message.toLowerCase()).not.toContain('licence');
    });
    And('the call was tried exactly twice', () => {
      expect(posts).toBe(2);
    });
  });

  Scenario('mw-t64a3.25 AC2: a failed challenge does not blame the licence', ({ Given, When, Then }) => {
    Given('a backend whose challenge answers 503', () => {
      backend(() => new Response('{}', { status: 200 }), () => new Response('', { status: 503 }));
    });
    When('a signed call is made with his key', call);
    Then('the call fails with a message that does not mention a licence', () => {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message.toLowerCase()).not.toContain('licence');
    });
  });
});
