// src/services/billing.ts — the Governor's 'API only' switch on a licence holder (docs/api.md,
// server/README.md: GET and PUT /api/register/billing). A holder is named as the Key screen lists it,
// by testnet address; the backend keeps the mark on the person who has a key there and answers it to the
// mill as billing. Only the Governor's key is let in: any other answer is the backend's own refusal.
import { apiFetch, type ApiFetchOptions } from './apiAuth';

export type BillingOptions = Pick<ApiFetchOptions, 'apiBase' | 'fetchImpl'>;

const PATH = '/register/billing';

/** The backend's own words for a refusal, else what the status says. */
async function refusal(response: Response): Promise<Error> {
  // 404 and 405: a backend from before the switch.
  if (response.status === 404 || response.status === 405) return new Error('Billing marks need a newer backend.');
  const body = (await response.json().catch(() => ({}))) as { error?: unknown };
  return new Error(typeof body.error === 'string' && body.error ? body.error : `The backend answered ${response.status}.`);
}

/** The holders (addresses) billed API only; a holder not in it is billed Max. */
export async function readApiOnly(key: Uint8Array, options: BillingOptions = {}): Promise<Set<string>> {
  const response = await apiFetch(PATH, undefined, { unlockedKey: key, ...options });
  if (!response.ok) throw await refusal(response);
  const body = (await response.json().catch(() => undefined)) as { api?: unknown } | undefined;
  if (!body || !Array.isArray(body.api)) throw new Error('The backend answered with something that is not the billing marks.');
  return new Set(body.api.filter((holder): holder is string => typeof holder === 'string'));
}

/** Marks the holder API only (true) or Max (false). Throws the backend's words when it does not keep it. */
export async function setApiOnly(key: Uint8Array, holder: string, apiOnly: boolean, options: BillingOptions = {}): Promise<void> {
  const body = JSON.stringify({ holder, billing: apiOnly ? 'api' : 'max' });
  const response = await apiFetch(PATH, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body }, { unlockedKey: key, ...options });
  if (!response.ok) throw await refusal(response);
}
