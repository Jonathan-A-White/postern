// tests/unit/compose.test.tsx — mw-tfne4.34: the 'Sent. Transaction id' line's
// txid must not overflow the phone screen; it needs the same break-all
// font-mono treatment the app already gives its other hashes.
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PrivateKey, Utils } from '@bsv/sdk';
import { Compose } from '../../src/compose';
import { db } from '../../src/data/db';
import { vaultRepo } from '../../src/data/repositories';
import { setKey, lock } from '../../src/services/keySession';
import { setMayorPublicKey } from '../../src/services/messages';
import { challengeResponse, isChallengeRequest } from '../support/challenge-fetch';

const MAYOR_KEY = PrivateKey.fromHex('99'.repeat(32));

beforeEach(async () => {
  await db.vault.clear();
  await db.settings.clear();
  await db.messages.clear();
  lock();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Compose: the sent txid line (mw-tfne4.34)', () => {
  it('shows the full txid but breaks it so it does not overflow the screen', async () => {
    const senderKey = PrivateKey.fromRandom();
    const senderMaster = new Uint8Array(Utils.toArray(senderKey.toHex(), 'hex'));
    await vaultRepo.save({
      mode: 'phrase',
      ciphertext: new Uint8Array([1]).buffer,
      iv: new Uint8Array(12),
      salt: new Uint8Array(16),
      prfFallbackReason: 'webauthn-unavailable',
      publicKeyHex: senderKey.toPublicKey().toString(),
    });
    setKey(senderMaster);
    await setMayorPublicKey(MAYOR_KEY.toPublicKey().toString());

    const txid = 'b'.repeat(64);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (isChallengeRequest(url)) return challengeResponse();
        if (url.includes('/utxos/')) {
          return new Response(
            JSON.stringify({ utxos: [{ txid: 'a'.repeat(64), vout: 0, satoshis: 10_000, height: 100 }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.endsWith('/broadcast')) {
          return new Response(JSON.stringify({ txid }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    render(<Compose />);
    await userEvent.type(await screen.findByLabelText('Message'), 'meet at the usual place');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    const sentLine = await screen.findByText(`Sent. Transaction id: ${txid}`);
    expect(sentLine.className).toContain('break-all');
    expect(sentLine.textContent).toBe(`Sent. Transaction id: ${txid}`);
  });
});
