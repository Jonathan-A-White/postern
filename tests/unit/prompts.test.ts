// tests/unit/prompts.test.ts — mw-nqur1n.4: the Prompts route, and fetchPrompts keeping
// the backend's list (with its ETag) in Dexie, asking again with If-None-Match and
// keeping what it has on a 304 or a failure.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Utils } from '@bsv/sdk';
import { formatRoute, isDeep, parseRoute, topViewOf } from '../../src/nav/route';
import { db } from '../../src/data/db';
import { settingsRepo } from '../../src/data/repositories';
import { fetchPrompts, optionChip, promptOfChannel, type Prompt } from '../../src/services/prompts';
import { challengeResponse, isChallengeRequest } from '../support/challenge-fetch';

const KEY = new Uint8Array(Utils.toArray('45'.repeat(32), 'hex'));

const TOP5: Prompt = { name: 'top5', summary: 's', signature: [{ flag: '--duration', type: 'duration', default: '30m' }], body: 'b', updatedAt: '2026-10-01T12:00:00Z', updatedBy: '02' };

describe('the Prompts route', () => {
  it('round-trips as ?v=prompts, is a step down from Me', () => {
    expect(formatRoute({ view: 'prompts' })).toBe('?v=prompts');
    expect(parseRoute('?v=prompts')).toEqual({ view: 'prompts' });
    expect(topViewOf({ view: 'prompts' })).toBe('me');
    expect(isDeep({ view: 'prompts' })).toBe(true);
  });

  it('carries the composer prefill of a talk route as p, only with a thread', () => {
    expect(formatRoute({ view: 'talk', thread: 'general', prefill: '/top5 ' })).toBe('?v=talk&t=general&p=%2Ftop5+');
    expect(parseRoute('?v=talk&t=general&p=%2Ftop5+')).toEqual({ view: 'talk', thread: 'general', prefill: '/top5 ' });
    expect(formatRoute({ view: 'talk', prefill: '/top5 ' })).toBe('?v=talk');
  });
});

describe('the prompt helpers', () => {
  it('writes an option as its flag and its default', () => {
    expect(optionChip({ flag: '--duration', type: 'duration', default: '30m' })).toBe('--duration 30m');
    expect(optionChip({ flag: '--who', type: 'string', required: true })).toBe('--who');
  });

  it("names the prompt a 'prompt:' channel is about", () => {
    expect(promptOfChannel('prompt:top5')).toBe('top5');
    expect(promptOfChannel('prompt:')).toBeUndefined();
    expect(promptOfChannel('mw-x')).toBeUndefined();
  });
});

describe('fetchPrompts', () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  function backend(answer: () => Response | Promise<Response>) {
    const calls: { url: string; headers: Headers }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (isChallengeRequest(String(url))) return challengeResponse();
      calls.push({ url: String(url), headers: new Headers(init?.headers) });
      return answer();
    });
    return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
  }

  it('keeps the list and its ETag, then asks again with If-None-Match and keeps it on a 304', async () => {
    const first = backend(() => new Response(JSON.stringify([TOP5]), { status: 200, headers: { ETag: '"v1"' } }));
    const got = await fetchPrompts(KEY, { fetchImpl: first.fetchImpl });
    expect(got?.prompts).toEqual([TOP5]);
    expect(first.calls[0].headers.get('If-None-Match')).toBeNull();
    expect((await settingsRepo.getPromptsCache())?.etag).toBe('"v1"');

    const second = backend(() => new Response(null, { status: 304 }));
    const again = await fetchPrompts(KEY, { fetchImpl: second.fetchImpl });
    expect(second.calls[0].headers.get('If-None-Match')).toBe('"v1"');
    expect(again?.prompts).toEqual([TOP5]);
    expect(again!.at).toBeGreaterThanOrEqual(got!.at);
  });

  it('answers undefined and keeps the stored list when the backend fails or cannot be reached', async () => {
    await settingsRepo.setPromptsCache({ etag: '"v1"', prompts: [TOP5], at: 1000 });
    expect(await fetchPrompts(KEY, { fetchImpl: backend(() => new Response('{}', { status: 501 })).fetchImpl })).toBeUndefined();
    expect(
      await fetchPrompts(KEY, {
        fetchImpl: backend(() => {
          throw new TypeError('Failed to fetch');
        }).fetchImpl,
      }),
    ).toBeUndefined();
    expect(await settingsRepo.getPromptsCache()).toEqual({ etag: '"v1"', prompts: [TOP5], at: 1000 });
  });
});
