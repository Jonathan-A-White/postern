// tests/support/challenge-fetch.ts — a GET /api/challenge double (docs/api.md),
// shared by every test whose fetch stub now sees this extra request: apiFetch
// (src/services/apiAuth.ts) fetches a fresh nonce before signing any
// authenticated call.
export function challengeResponse(nonce = 'a'.repeat(64)): Response {
  return new Response(JSON.stringify({ nonce }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function isChallengeRequest(url: string): boolean {
  return url.endsWith('/challenge');
}
