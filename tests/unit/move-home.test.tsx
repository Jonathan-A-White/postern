// tests/unit/move-home.test.tsx — mw-43v9x.9 (Q2): the one tap that moves the
// factory's home. The Me screen's Home row, its single confirm, the message it
// sends (class move-home, body {"host": …}), and the 'Home is down' offer the
// shell makes on every screen while the API answers 503 standby.
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PrivateKey, Utils } from '@bsv/sdk';
import { MeScreen } from '../../src/cockpit/MeScreen';
import { Shell } from '../../src/cockpit/Shell';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { fixtureView } from '../support/cockpit-fixture';
import { challengeResponse, isChallengeRequest } from '../support/challenge-fetch';
import { deliverMoveHome } from '../../src/services/deliver';
import { apiFetch } from '../../src/services/apiAuth';
import { clearStandby, getStandby } from '../../src/services/standby';
import { decryptMessageAsSender } from '../../src/services/messages';

const { KEY } = vi.hoisted(() => ({ KEY: new Uint8Array(32) }));

vi.mock('../../src/services/deliver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/deliver')>()),
  deliverMoveHome: vi.fn(async () => ({ txid: 'direct:' + '1'.repeat(64), channel: 'direct' as const })),
}));
vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  deliverOptions: () => ({ key: KEY, mayorKey: '02' + '11'.repeat(32), direct: true }),
}));
vi.mock('../../src/services/keySession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/keySession')>()),
  getKey: () => KEY,
}));

const standby503 = (home?: string) =>
  new Response(JSON.stringify({ standby: true, ...(home ? { home } : {}) }), { status: 503, headers: { 'Content-Type': 'application/json' } });

async function storeView(host: string): Promise<void> {
  const view = fixtureView(Date.now());
  view.host = host;
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, source: 'live', fetchedAt: Date.now() });
}

/** The API answers 503 standby on a route a standby host does not serve. */
async function apiSaysStandby(home?: string): Promise<void> {
  const fetchImpl = vi.fn(async (url: string | URL | Request) => (isChallengeRequest(String(url)) ? challengeResponse() : standby503(home)));
  await act(async () => {
    await apiFetch('/view', undefined, { unlockedKey: new Uint8Array(32), fetchImpl: fetchImpl as unknown as typeof fetch });
  });
}

beforeEach(async () => {
  vi.mocked(deliverMoveHome).mockClear();
  clearStandby();
  await Promise.all([db.view.clear(), db.messages.clear()]);
});
afterEach(() => cleanup());
afterAll(() => cleanup());

describe('Me screen: the Home row', () => {
  it('shows the home the view names and disables that button', async () => {
    await storeView('desktop');
    render(<MeScreen />);
    const row = within(await screen.findByLabelText('Home'));
    expect(await row.findByText('desktop')).toBeInTheDocument();
    expect(row.getByRole('button', { name: 'Move home to desktop' })).toBeDisabled();
    expect(row.getByRole('button', { name: 'Move home to laptop' })).toBeEnabled();
  });

  it('disables the laptop button when the laptop is home', async () => {
    await storeView('laptop');
    render(<MeScreen />);
    const row = within(await screen.findByLabelText('Home'));
    await waitFor(() => expect(row.getByRole('button', { name: 'Move home to laptop' })).toBeDisabled());
    expect(row.getByRole('button', { name: 'Move home to desktop' })).toBeEnabled();
  });

  it("says 'unknown' while the backend is in standby, and offers both", async () => {
    await storeView('desktop');
    await apiSaysStandby();
    render(<MeScreen />);
    const row = within(await screen.findByLabelText('Home'));
    expect(row.getByText('unknown')).toBeInTheDocument();
    expect(row.getByRole('button', { name: 'Move home to desktop' })).toBeEnabled();
    expect(row.getByRole('button', { name: 'Move home to laptop' })).toBeEnabled();
  });
});

describe('the confirm', () => {
  it('sends nothing until he confirms, and nothing at all if he cancels', async () => {
    await storeView('desktop');
    render(<MeScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'Move home to laptop' }));
    const confirm = await screen.findByRole('group', { name: 'Confirm' });
    expect(within(confirm).getByText("Move the factory's home to laptop? The Mayor there takes over.")).toBeInTheDocument();
    expect(deliverMoveHome).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'Confirm' })).toBeNull();
    expect(deliverMoveHome).not.toHaveBeenCalled();
  });

  it('sends one move-home message for the host once he confirms', async () => {
    await storeView('desktop');
    render(<MeScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'Move home to laptop' }));
    await userEvent.click(within(await screen.findByRole('group', { name: 'Confirm' })).getByRole('button', { name: 'Move home' }));
    await waitFor(() => expect(deliverMoveHome).toHaveBeenCalledTimes(1));
    expect(deliverMoveHome).toHaveBeenCalledWith('laptop', expect.objectContaining({ mayorKey: '02' + '11'.repeat(32) }));
  });
});

describe('deliverMoveHome', () => {
  it("posts a record of class move-home whose plaintext is {\"host\": …}, signed by his key", async () => {
    const { deliverMoveHome: real } = await vi.importActual<typeof import('../../src/services/deliver')>('../../src/services/deliver');
    const mayor = PrivateKey.fromHex('77'.repeat(32));
    const key = new Uint8Array(Utils.toArray('45'.repeat(32), 'hex'));
    let posted: { scriptHex?: string } = {};
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (isChallengeRequest(String(url))) return challengeResponse();
      posted = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ txid: '2'.repeat(64) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const delivered = await real('laptop', { key, mayorKey: mayor.toPublicKey().toString(), direct: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(delivered).toEqual({ txid: '2'.repeat(64), channel: 'direct' });
    const stored = await db.messages.get(`${'2'.repeat(64)}:0`);
    expect(stored?.class).toBe('move-home');
    expect(JSON.parse(stored!.plaintext!)).toEqual({ host: 'laptop' });
    // the record on the wire names the class in the clear and decrypts to the same body
    const { decodeRecordScript } = await import('spell-forge-bsv');
    const { Script } = await import('@bsv/sdk');
    const payload = JSON.parse(Utils.toUTF8(decodeRecordScript(Script.fromHex(posted.scriptHex!))!.payloadBytes));
    expect(payload.class).toBe('move-home');
    expect(JSON.parse(decryptMessageAsSender(payload, Utils.toHex(Array.from(key))))).toEqual({ host: 'laptop' });
  });
});

describe('the shell when the home is down', () => {
  it("says 'Home is down' on a standby answer and offers the other host, on any screen", async () => {
    await storeView('desktop');
    await apiSaysStandby('desktop');
    render(
      <Shell route={{ view: 'talk' }}>
        <p>somewhere else</p>
      </Shell>,
    );
    const banner = await screen.findByRole('region', { name: 'Home is down' });
    expect(within(banner).getByText('Home is down')).toBeInTheDocument();
    expect(within(banner).queryByRole('button', { name: 'Move home to desktop' })).toBeNull();
    await userEvent.click(within(banner).getByRole('button', { name: 'Move home to laptop' }));
    expect(deliverMoveHome).not.toHaveBeenCalled();
    await userEvent.click(within(await screen.findByRole('group', { name: 'Confirm' })).getByRole('button', { name: 'Move home' }));
    await waitFor(() => expect(deliverMoveHome).toHaveBeenCalledWith('laptop', expect.anything()));
  });

  it('shows no such banner while the API answers', async () => {
    await storeView('desktop');
    render(
      <Shell route={{ view: 'talk' }}>
        <p>somewhere else</p>
      </Shell>,
    );
    await screen.findByText('somewhere else');
    expect(screen.queryByText('Home is down')).toBeNull();
  });

  it('drops the banner once a route the standby host does not serve answers again', async () => {
    await apiSaysStandby('desktop');
    expect(getStandby()).toEqual({ home: 'desktop' });
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      isChallengeRequest(String(url)) ? challengeResponse() : new Response('{}', { status: 200 }),
    );
    await apiFetch('/view', undefined, { unlockedKey: new Uint8Array(32), fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(getStandby()).toBeNull();
  });

  it('keeps the banner across the routes a standby host still serves', async () => {
    await apiSaysStandby();
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      isChallengeRequest(String(url)) ? challengeResponse() : new Response('{}', { status: 200 }),
    );
    await apiFetch('/me', undefined, { unlockedKey: new Uint8Array(32), fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(getStandby()).not.toBeNull();
  });
});
