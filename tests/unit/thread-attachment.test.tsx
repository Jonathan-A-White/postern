// tests/unit/thread-attachment.test.tsx — mw-dxy1c.2: the thread reply box's
// attach control encrypts one image to the Mayor's key, uploads it to
// POST /api/blobs, and sends it as the message's attachment field alongside
// the caption (docs/protocol.md §8).
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PrivateKey, Transaction, Utils } from '@bsv/sdk';
import { decodeRecordScript } from 'spell-forge-bsv';
import { ThreadScreen } from '../../src/threads/ThreadScreen';
import { db } from '../../src/data/db';
import { vaultRepo } from '../../src/data/repositories';
import { setKey, lock } from '../../src/services/keySession';
import { decryptMessage, encryptAttachment, setMayorPublicKey, type MessagePayload } from '../../src/services/messages';
import { decodeThreadedMessage } from '../../src/services/threads';
import { challengeResponse, isChallengeRequest } from '../support/challenge-fetch';

const MAYOR_KEY = PrivateKey.fromHex('99'.repeat(32));

function utxosResponse(satoshis: number): Response {
  return new Response(JSON.stringify({ utxos: [{ txid: 'a'.repeat(64), vout: 0, satoshis, height: 100 }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function messagesResponse(): Response {
  return new Response(JSON.stringify({ records: [], next: 0 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Utils.toHex(Array.from(new Uint8Array(digest)));
}

async function setUpUnlockedVault(): Promise<{ senderKey: PrivateKey; senderMaster: Uint8Array }> {
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
  return { senderKey, senderMaster };
}

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

describe('ThreadScreen: attaching an image (mw-dxy1c.2)', () => {
  it('AC1: uploads the encrypted image then sends a message carrying the attachment and caption', async () => {
    const { senderKey } = await setUpUnlockedVault();

    let uploadedBody: Uint8Array | undefined;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (isChallengeRequest(url)) return challengeResponse();
      if (url.endsWith('/blobs')) {
        uploadedBody = new Uint8Array(init!.body as Uint8Array);
        const hash = await sha256Hex(uploadedBody);
        return new Response(JSON.stringify({ hash, size: uploadedBody.length }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/utxos/')) return utxosResponse(10_000);
      if (url.endsWith('/broadcast')) {
        const body = JSON.parse(String(init?.body)) as { rawtx: string };
        const tx = Transaction.fromHex(body.rawtx);
        return new Response(JSON.stringify({ txid: tx.id('hex') }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/messages')) return messagesResponse();
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);

    render(<ThreadScreen />);

    const bytes = new Uint8Array(200 * 1024).fill(9);
    const file = new File([bytes], 'shot.png', { type: 'image/png' });
    await userEvent.upload(await screen.findByLabelText('Attach image'), file);
    await userEvent.type(screen.getByLabelText('Reply'), 'look at this');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText(/^Sent\. Transaction id:/);

    const blobsCall = fetchImpl.mock.calls.find(([url]) => String(url).endsWith('/blobs'));
    expect(blobsCall).toBeDefined();
    expect(blobsCall![1]?.method).toBe('POST');
    expect(uploadedBody).toBeDefined();

    // The ciphertext's byte length is deterministic (fixed BRC-78 envelope
    // overhead plus the AES-GCM tag) even though its bytes are randomised —
    // encrypting the same-length plaintext independently gives the same length.
    const independentCiphertext = encryptAttachment({
      bytes,
      senderPrivateKeyHex: senderKey.toHex(),
      recipientPublicKeyHex: MAYOR_KEY.toPublicKey().toString(),
    });
    expect(uploadedBody!.length).toBe(independentCiphertext.length);

    const broadcastCall = fetchImpl.mock.calls.find(([url]) => String(url).endsWith('/broadcast'));
    expect(broadcastCall).toBeDefined();
    const rawtx = (JSON.parse(String(broadcastCall![1]?.body)) as { rawtx: string }).rawtx;
    const tx = Transaction.fromHex(rawtx);
    const decoded = decodeRecordScript(tx.outputs[0].lockingScript);
    expect(decoded).not.toBeNull();
    const payload = JSON.parse(Utils.toUTF8(decoded!.payloadBytes)) as MessagePayload;
    const plaintext = decryptMessage(payload, MAYOR_KEY.toHex());
    const body = decodeThreadedMessage(plaintext);

    expect(body.text).toBe('look at this');
    expect(body.attachment?.mime).toBe('image/png');
    expect(body.attachment?.size).toBe(uploadedBody!.length);
    expect(body.attachment?.hash).toBe(await sha256Hex(uploadedBody!));
  });

  it('AC2: refuses a file over 8 MB before any upload, naming the cap', async () => {
    await setUpUnlockedVault();

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (isChallengeRequest(url)) return challengeResponse();
      if (url.endsWith('/messages')) return messagesResponse();
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);

    render(<ThreadScreen />);
    await screen.findByLabelText('Reply');
    fetchImpl.mockClear();

    const bytes = new Uint8Array(9 * 1024 * 1024);
    const file = new File([bytes], 'big.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('Attach image'), file);

    expect(await screen.findByText(/8 MB/)).toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(screen.queryByText('big.png')).not.toBeInTheDocument();
  });

  it('AC3: shows the upload error and sends nothing when the upload fails', async () => {
    await setUpUnlockedVault();

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (isChallengeRequest(url)) return challengeResponse();
      if (url.endsWith('/blobs')) {
        return new Response(JSON.stringify({ error: 'blob storage unavailable' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/messages')) return messagesResponse();
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);

    render(<ThreadScreen />);

    const bytes = new Uint8Array(200 * 1024).fill(3);
    const file = new File([bytes], 'shot.png', { type: 'image/png' });
    await userEvent.upload(await screen.findByLabelText('Attach image'), file);
    await userEvent.type(screen.getByLabelText('Reply'), 'look at this');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('blob storage unavailable')).toBeInTheDocument();
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('/utxos/'))).toBe(false);
    expect(fetchImpl.mock.calls.some(([url]) => String(url).endsWith('/broadcast'))).toBe(false);
  });
});
