// src/services/prompts.ts — the saved prompts (server/README.md, "Saved prompts"): the
// backend is the definitive store, so the app asks. GET /api/prompts answers a list
// sorted by name with an ETag; the last answer is kept in the settings table so the
// list still shows with no network, stamped with when it was fetched.
import { settingsRepo } from '../data/repositories';
import type { Prompt, PromptOption, PromptsCache } from '../data/db';
import { apiFetch } from './apiAuth';

export type { Prompt, PromptOption, PromptsCache };

export interface PromptsOptions {
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

function isPrompt(value: unknown): value is Prompt {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.name === 'string' && typeof row.summary === 'string' && typeof row.body === 'string' && Array.isArray(row.signature);
}

/** The channel a prompt is talked about in (the named channel 'prompt:<name>'). */
export function promptChannel(name: string): string {
  return `prompt:${name}`;
}

/** The prompt a channel name talks about: 'prompt:top5' is 'top5'; any other channel, undefined. */
export function promptOfChannel(channel: string): string | undefined {
  return channel.startsWith('prompt:') && channel.length > 7 ? channel.slice(7) : undefined;
}

/** An option as a chip reads: '--duration 30m' with a default, else just '--who'; the free-text option is '<text>'. */
export function optionChip(option: PromptOption): string {
  if (option.type === 'text') return `<${option.flag.replace(/^-+/, '')}>`;
  return option.default ? `${option.flag} ${option.default}` : option.flag;
}

/**
 * Asks the backend for the saved prompts and keeps the answer. A 304 keeps what is
 * stored (and says it is fresh now). Returns what the phone now holds, or undefined
 * when it could not be fetched and nothing was kept — a refusal, no network, an
 * older backend without the route: the caller shows the stored list, if any.
 */
export async function fetchPrompts(key: Uint8Array, options: PromptsOptions = {}): Promise<PromptsCache | undefined> {
  const stored = await settingsRepo.getPromptsCache();
  try {
    const headers: Record<string, string> = {};
    if (stored?.etag) headers['If-None-Match'] = stored.etag;
    const response = await apiFetch('/prompts', { headers }, { unlockedKey: key, ...options });
    if (response.status === 304 && stored) {
      const fresh = { ...stored, at: Date.now() };
      await settingsRepo.setPromptsCache(fresh);
      return fresh;
    }
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    if (!Array.isArray(body)) return undefined;
    const fresh: PromptsCache = { etag: response.headers.get('ETag') ?? undefined, prompts: body.filter(isPrompt), at: Date.now() };
    await settingsRepo.setPromptsCache(fresh);
    return fresh;
  } catch {
    return undefined;
  }
}
