import { describe, it, expect, vi } from 'vitest';
import { P2PKH, PrivateKey, Transaction, Utils } from '@bsv/sdk';
import { decodeRecordScript } from 'spell-forge-bsv';
import { sendTextMessage } from '../../src/services/send';
import { ANCHOR_ADDRESS, decryptMessage, type MessagePayload } from '../../src/services/messages';

function utxosResponse(satoshis: number): Response {
  return new Response(
    JSON.stringify({ utxos: [{ txid: 'a'.repeat(64), vout: 0, satoshis, height: 100 }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('sendTextMessage', () => {
  it('builds a signed record transaction and broadcasts it, resolving the txid', async () => {
    const senderKey = PrivateKey.fromRandom();
    const senderMaster = new Uint8Array(Utils.toArray(senderKey.toHex(), 'hex'));
    const recipient = PrivateKey.fromRandom();

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/utxos/')) {
        return utxosResponse(10_000);
      }
      if (url.endsWith('/broadcast')) {
        const body = JSON.parse(String(init?.body)) as { rawtx: string };
        const tx = Transaction.fromHex(body.rawtx);
        return new Response(JSON.stringify({ txid: tx.id('hex') }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const txid = await sendTextMessage({
      text: 'the gate is open',
      class: 'message',
      senderKey: senderMaster,
      recipientPublicKeyHex: recipient.toPublicKey().toString(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(txid).toMatch(/^[0-9a-f]{64}$/);

    const broadcastCall = fetchImpl.mock.calls.find(([url]) => String(url).endsWith('/broadcast'));
    expect(broadcastCall).toBeDefined();
    const rawtx = (JSON.parse(String(broadcastCall![1]?.body)) as { rawtx: string }).rawtx;
    const tx = Transaction.fromHex(rawtx);

    // Output 0 is the zero-sat record; output 1 pays the anchor 1 sat; output 2 is change.
    expect(tx.outputs[0].satoshis).toBe(0);
    expect(tx.outputs[1].satoshis).toBe(1);
    expect(tx.outputs[1].lockingScript.toHex()).toBe(new P2PKH().lock(ANCHOR_ADDRESS).toHex());

    const decoded = decodeRecordScript(tx.outputs[0].lockingScript);
    expect(decoded).not.toBeNull();
    const payloadJson = JSON.parse(Utils.toUTF8(decoded!.payloadBytes)) as MessagePayload;
    expect(payloadJson.kind).toBe('msg');
    expect(payloadJson.class).toBe('message');
    expect(decryptMessage(payloadJson, recipient.toHex())).toBe('the gate is open');
  });

  it('throws and broadcasts nothing when the backend has no UTXOs to spend', async () => {
    const senderMaster = new Uint8Array(Utils.toArray(PrivateKey.fromRandom().toHex(), 'hex'));
    const recipient = PrivateKey.fromRandom();
    const fetchImpl = vi.fn(async () => utxosResponse(1));

    await expect(
      sendTextMessage({
        text: 'hello',
        class: 'message',
        senderKey: senderMaster,
        recipientPublicKeyHex: recipient.toPublicKey().toString(),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/no spendable coins/i);
  });

  it('surfaces the backend error and never calls broadcast on a utxo fetch failure', async () => {
    const senderMaster = new Uint8Array(Utils.toArray(PrivateKey.fromRandom().toHex(), 'hex'));
    const recipient = PrivateKey.fromRandom();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'WhatsOnChain said 502: unreachable' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      sendTextMessage({
        text: 'hello',
        class: 'message',
        senderKey: senderMaster,
        recipientPublicKeyHex: recipient.toPublicKey().toString(),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('WhatsOnChain said 502: unreachable');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('surfaces the backend error when broadcast is rejected', async () => {
    const senderMaster = new Uint8Array(Utils.toArray(PrivateKey.fromRandom().toHex(), 'hex'));
    const recipient = PrivateKey.fromRandom();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/utxos/')) return utxosResponse(10_000);
      return new Response(JSON.stringify({ error: 'tx rejected: bad-txns-inputs-missingorspent' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await expect(
      sendTextMessage({
        text: 'hello',
        class: 'message',
        senderKey: senderMaster,
        recipientPublicKeyHex: recipient.toPublicKey().toString(),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('tx rejected: bad-txns-inputs-missingorspent');
  });
});
