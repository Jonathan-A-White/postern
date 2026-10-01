import { describe, expect, it } from 'vitest';
import { routeShows } from '../../src/services/seen';

const ROOT = 'a1'.repeat(32);

describe('routeShows (mw-gq6.166)', () => {
  it('a channel on screen shows its own posts and the replies under them', () => {
    expect(routeShows({ view: 'talk', thread: 'topic:ops' }, { view: 'talk', thread: 'topic:ops' })).toBe(true);
    expect(routeShows({ view: 'talk', thread: 'topic:ops' }, { view: 'talk', thread: 'topic:ops', root: ROOT })).toBe(true);
  });

  it('another channel, or the bare channel list, shows nothing of it', () => {
    expect(routeShows({ view: 'talk', thread: 'topic:plans' }, { view: 'talk', thread: 'topic:ops' })).toBe(false);
    expect(routeShows({ view: 'talk' }, { view: 'talk', thread: 'topic:ops' })).toBe(false);
    expect(routeShows({ view: 'needs' }, { view: 'talk', thread: 'topic:ops' })).toBe(false);
  });

  it('an open reply thread shows only its own post', () => {
    const open = { view: 'talk', thread: 'general', root: ROOT } as const;
    expect(routeShows(open, { view: 'talk', thread: 'general', root: ROOT.toUpperCase() })).toBe(true);
    expect(routeShows(open, { view: 'talk', thread: 'general', root: 'b2'.repeat(32) })).toBe(false);
    expect(routeShows(open, { view: 'talk', thread: 'general' })).toBe(false);
  });

  it("a bead's screen shows that bead's thread", () => {
    expect(routeShows({ view: 'bead', id: 'mw-1' }, { view: 'talk', thread: 'bead:mw-1' })).toBe(true);
    expect(routeShows({ view: 'bead', id: 'mw-2' }, { view: 'talk', thread: 'bead:mw-1' })).toBe(false);
  });
});
