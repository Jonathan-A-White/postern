// tests/unit/standby-note.test.ts — mw-7dige5.1: 'Home is down' ends on a 304 too, the answer to a conditional
// GET /api/view from a host that is home (a probe asks with If-None-Match: * and gets nothing else).
import { afterEach, describe, expect, it } from 'vitest';
import { clearStandby, getStandby, noteApiResponse } from '../../src/services/standby';

afterEach(clearStandby);

const standby503 = () => new Response(JSON.stringify({ standby: true, home: 'laptop' }), { status: 503 });

describe('noteApiResponse', () => {
  it('raises the standby state on a standby 503', async () => {
    await noteApiResponse('/view', standby503());
    expect(getStandby()).toEqual({ home: 'laptop' });
  });

  it('ends it on a 200 from a route standby does not serve', async () => {
    await noteApiResponse('/view', standby503());
    await noteApiResponse('/view', new Response('x', { status: 200 }));
    expect(getStandby()).toBeNull();
  });

  it('ends it on a 304 from such a route', async () => {
    await noteApiResponse('/view', standby503());
    await noteApiResponse('/view', new Response(null, { status: 304 }));
    expect(getStandby()).toBeNull();
  });

  it('is not ended by a route standby serves', async () => {
    await noteApiResponse('/view', standby503());
    await noteApiResponse('/messages', new Response('x', { status: 200 }));
    expect(getStandby()).toEqual({ home: 'laptop' });
  });
});
