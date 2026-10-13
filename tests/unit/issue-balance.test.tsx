// The issue form's balance line (mw-swrev1): when the chain refuses the balance read, the line says
// why (as the Key screen does), the read is tried again with a growing wait, and a later success shows
// the balance; a successful Issue reads it again. issuerBalance, the listing and /api/me are stubbed.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chain, setChain, type Chain } from '../../src/chain';
import { IssueLicences } from '../../src/key/IssueLicences';
import { HOLDERS, ISSUER_MASTER } from '../support/issue-burst';

vi.mock('../../src/services/me', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/me')>()),
  fetchMe: vi.fn(async () => ({ pubkey: '', collections: [{ name: 'legend', app: '' }] })),
}));

afterAll(() => cleanup());

let restore: Chain | undefined;

function stubChain(issuerBalance: Chain['issuerBalance'], extra: Partial<Chain> = {}) {
  restore = setChain({
    ...chain,
    issuerBalance,
    issuedLicences: vi.fn(async () => []),
    ...extra,
  });
}

/** Lets IndexedDB settle: fake-indexeddb answers on setImmediate, which is not faked. */
const settle = async () => {
  for (let n = 0; n < 20; n += 1) await act(() => new Promise<void>((resolve) => setImmediate(resolve)));
};

/** Lets the pending reads and effects settle, with the clock moved on by `ms`. */
const pass = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe('the issue form balance line', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    if (restore) setChain(restore);
    restore = undefined;
  });

  it('says why the balance could not be read, as the Key screen does', async () => {
    stubChain(vi.fn().mockRejectedValue(new Error('the node is out to lunch')));
    render(<IssueLicences issuerKey={ISSUER_MASTER} />);
    await pass(0);
    expect(screen.getByTestId('issue-cost')).toHaveTextContent('Balance unavailable (WhatsOnChain): the node is out to lunch');
  });

  it('tries a failed read again, later and later, and shows the balance when one succeeds', async () => {
    const issuerBalance = vi
      .fn()
      .mockRejectedValueOnce(new Error('429'))
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValue(12_345);
    stubChain(issuerBalance);
    render(<IssueLicences issuerKey={ISSUER_MASTER} />);
    await pass(0);
    expect(issuerBalance).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('issue-cost')).toHaveTextContent('Balance unavailable (WhatsOnChain)');

    // the second read comes after a wait, the third after a longer one: each wait is a render of its own
    for (let n = 0; n < 4; n += 1) await pass(10_000);
    expect(issuerBalance).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('issue-cost')).toHaveTextContent('Balance: 12,345 sats.');
    expect(screen.getByTestId('issue-cost')).not.toHaveTextContent('Balance unavailable');
  });

  it('offers a button to read the balance again once the automatic tries are used up', async () => {
    const issuerBalance = vi.fn().mockRejectedValue(new Error('429'));
    stubChain(issuerBalance);
    render(<IssueLicences issuerKey={ISSUER_MASTER} />);
    await pass(0);
    expect(screen.queryByRole('button', { name: 'Check balance again' })).toBeNull();
    for (let n = 0; n < 20; n += 1) await pass(70_000);
    const reads = issuerBalance.mock.calls.length;
    expect(reads).toBe(6);
    issuerBalance.mockResolvedValue(777);
    fireEvent.click(screen.getByRole('button', { name: 'Check balance again' }));
    await pass(0);
    expect(screen.getByTestId('issue-cost')).toHaveTextContent('Balance: 777 sats.');
    expect(screen.queryByRole('button', { name: 'Check balance again' })).toBeNull();
  });

  it('reads the balance again after a successful Issue', async () => {
    const issuerBalance = vi.fn().mockResolvedValueOnce(50_000).mockResolvedValue(48_000);
    stubChain(issuerBalance, {
      issueLicence: vi.fn(async () => ({ txid: 'ab'.repeat(32), origin: `${'ab'.repeat(32)}_0`, holder: HOLDERS[0], collection: 'legend' })),
    });
    render(<IssueLicences issuerKey={ISSUER_MASTER} />);
    await pass(0);
    expect(screen.getByTestId('issue-cost')).toHaveTextContent('Balance: 50,000 sats.');

    const form = screen.getByRole('region', { name: 'Issue a licence' });
    fireEvent.change(within(form).getByLabelText("Holder's public key"), { target: { value: HOLDERS[0] } });
    fireEvent.click(within(form).getByRole('button', { name: 'Issue' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Confirm issue' }));
    await settle();
    await pass(100);
    expect(screen.getByTestId('issue-cost')).toHaveTextContent('Balance: 48,000 sats.');
    expect(issuerBalance).toHaveBeenCalledTimes(2);
  });
});
