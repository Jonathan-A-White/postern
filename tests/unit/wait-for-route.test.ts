import { afterEach, describe, expect, it } from 'vitest';
import { SLOW_HOST_MS, waitForRoute } from '../support/wait-for-route';

describe('waitForRoute (mw-xhtcup.17)', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('gives a slow host ten seconds, not waitFor\'s default second', () => {
    expect(SLOW_HOST_MS).toBe(10_000);
  });

  it('resolves once the address bar names the route', async () => {
    window.history.replaceState(null, '', '/?v=search&q=x');
    setTimeout(() => window.history.replaceState(null, '', '/?v=bead&id=mw-a.1'), 20);
    await waitForRoute({ view: 'bead', id: 'mw-a.1' }, 2000);
  });

  it('fails when the route never opens, and the message names the route seen', async () => {
    window.history.replaceState(null, '', '/?v=search&q=mw-a.1');
    await expect(waitForRoute({ view: 'bead', id: 'mw-a.1' }, 100)).rejects.toThrow(
      /route seen: .*"view":"search".*"q":"mw-a\.1"/,
    );
  });
});
