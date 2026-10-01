import { test, expect, type APIRequestContext } from '@playwright/test';

// The laptop's backend can be mid-restart (mw-dxy1c.4): tolerate a 502/504 from
// nginx's /api/ proxy for up to two minutes before treating it as a real failure.
const HEALTHZ_RETRY_BUDGET_MS = 120_000;
const HEALTHZ_RETRY_INTERVAL_MS = 5_000;

async function waitForHealthz(request: APIRequestContext, deadline: number): Promise<void> {
  for (;;) {
    const response = await request.get('/api/healthz');
    const status = response.status();
    if (status !== 502 && status !== 504) {
      expect(response.ok()).toBe(true);
      expect(await response.json()).toMatchObject({ ok: true, commit: expect.any(String) });
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`/api/healthz kept answering ${status} through the retry budget`);
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTHZ_RETRY_INTERVAL_MS));
  }
}

test('the live /api proxy reaches the backend: healthz and messages both answer', async ({ request }) => {
  test.setTimeout(HEALTHZ_RETRY_BUDGET_MS + 30_000);

  await waitForHealthz(request, Date.now() + HEALTHZ_RETRY_BUDGET_MS);

  // No key needed here: an unauthenticated caller still gets a JSON response
  // (either the record page or docs/api.md's `{"error": "..."}` shape) — this
  // proves the proxy reaches the backend's real handler, not just healthz.
  const messages = await request.get('/api/messages');
  const body = await messages.json();
  expect(body).toBeTruthy();
});
