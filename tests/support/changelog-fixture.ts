// tests/support/changelog-fixture.ts — a believable changelog.json for the What's new tests (mw-s061bg.3):
// a version newer than the running one (the waiting build), the running version, and an old one.
import { vi } from 'vitest';
import { APP_VERSION } from '../../src/services/whatsNew';

export const WAITING_VERSION = '99.1.0';

export interface Line {
  version: string;
  date: string;
  story: string;
  kind: 'new' | 'fixed';
  text: string;
}

export function changelogFixture(): Line[] {
  return [
    { version: WAITING_VERSION, date: '2026-12-01', story: 'app-9a', kind: 'fixed', text: 'The list no longer jumps.' },
    { version: WAITING_VERSION, date: '2026-12-01', story: 'app-9b', kind: 'new', text: 'Pin a message to the top.' },
    { version: WAITING_VERSION, date: '2026-12-01', story: 'app-9c', kind: 'new', text: 'Voice notes keep their place.' },
    { version: APP_VERSION, date: '2026-10-09', story: 'app-8', kind: 'new', text: 'Search finds beads.' },
    { version: '0.0.5', date: '2026-08-01', story: 'app-1', kind: 'fixed', text: 'Old fix.' },
  ];
}

/** Makes fetch answer /changelog.json with `entries`, or with a 404 when null. Returns the mock. */
export function stubChangelog(entries: Line[] | null) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('changelog.json') && entries) return new Response(JSON.stringify(entries), { status: 200 });
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
