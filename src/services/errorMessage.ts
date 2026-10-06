// src/services/errorMessage.ts — the backend's own words for a refusal: the `error` of its JSON
// body, or `fallback` when the body is not that. Not chain code; lifted out of spendable.ts
// (mw-e6e8f2.2) so deliver and attachments need no chain module.
export async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : fallback;
  } catch {
    return fallback;
  }
}
