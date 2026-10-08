import { describe, it, expect, vi, afterEach } from 'vitest';
import { P2PKH, PrivateKey, Transaction, Utils } from '@bsv/sdk';
import { decodeRecordScript, outpointKey } from 'spell-forge-bsv';
import { sendTextMessage } from '../../src/services/send';
import { ANCHOR_ADDRESS, decryptMessage, type MessagePayload } from '../../src/services/messages';
import { challengeResponse, isChallengeRequest } from '../support/challenge-fetch';
import { db } from '../../src/data/db';

function utxosResponse(satoshis: number): Response {
  return new Response(
    JSON.stringify({ utxos: [{ txid: 'a'.repeat(64), vout: 0, satoshis, height: 100 }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('sendTextMessage', () => {
  afterEach(async () => {
    await db.pendingSpends.clear();
  });

  it('builds a signed record transaction and broadcasts it, resolving the txid', async () => {
    const senderKey = PrivateKey.fromRandom();
    const senderMaster = new Uint8Array(Utils.toArray(senderKey.toHex(), 'hex'));
    const recipient = PrivateKey.fromRandom();

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (isChallengeRequest(url)) return challengeResponse();
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

  it('signs a challenge with the sender key on every call, in a header the recipient can verify', async () => {
    const senderKey = PrivateKey.fromRandom();
    const senderMaster = new Uint8Array(Utils.toArray(senderKey.toHex(), 'hex'));
    const recipient = PrivateKey.fromRandom();
    const authHeaders: string[] = [];

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (isChallengeRequest(url)) return challengeResponse();
      const auth = new Headers(init?.headers).get('Authorization');
      if (auth) authHeaders.push(auth);
      if (url.includes('/utxos/')) return utxosResponse(10_000);
      if (url.endsWith('/broadcast')) {
        const body = JSON.parse(String(init?.body)) as { rawtx: string };
        return new Response(JSON.stringify({ txid: Transaction.fromHex(body.rawtx).id('hex') }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await sendTextMessage({
      text: 'the gate is open',
      class: 'message',
      senderKey: senderMaster,
      recipientPublicKeyHex: recipient.toPublicKey().toString(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(authHeaders).toHaveLength(2);
    for (const header of authHeaders) {
      const match = header.match(/^Postern2 ([0-9a-f]+):([0-9a-f]+):([0-9a-f]+)$/);
      expect(match).not.toBeNull();
      expect(match![1]).toBe(senderKey.toPublicKey().toString());
    }
  });

  it('throws "Licence required" on a 401, not the raw fetch error', async () => {
    const senderMaster = new Uint8Array(Utils.toArray(PrivateKey.fromRandom().toHex(), 'hex'));
    const recipient = PrivateKey.fromRandom();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (isChallengeRequest(url)) return challengeResponse();
      return new Response(JSON.stringify({ error: 'no licence held' }), { status: 401 });
    });

    await expect(
      sendTextMessage({
        text: 'hello',
        class: 'message',
        senderKey: senderMaster,
        recipientPublicKeyHex: recipient.toPublicKey().toString(),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('Licence required');
  });

  it('throws and broadcasts nothing when the backend has no UTXOs to spend', async () => {
    const senderMaster = new Uint8Array(Utils.toArray(PrivateKey.fromRandom().toHex(), 'hex'));
    const recipient = PrivateKey.fromRandom();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (isChallengeRequest(url)) return challengeResponse();
      return utxosResponse(1);
    });

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
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (isChallengeRequest(url)) return challengeResponse();
      return new Response(JSON.stringify({ error: 'WhatsOnChain said 502: unreachable' }), {
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
    ).rejects.toThrow('WhatsOnChain said 502: unreachable');
    expect(fetchImpl.mock.calls.filter(([url]) => !isChallengeRequest(String(url)))).toHaveLength(1);
  });

  it('surfaces the backend error when broadcast is rejected', async () => {
    const senderMaster = new Uint8Array(Utils.toArray(PrivateKey.fromRandom().toHex(), 'hex'));
    const recipient = PrivateKey.fromRandom();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (isChallengeRequest(url)) return challengeResponse();
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

  describe('pending spends (mw-1589l.28)', () => {
    it('AC1: excludes an outpoint its own broadcast already spent, and spends the remembered change output, when the backend keeps listing the old outpoint and omits the new one', async () => {
      const senderKey = PrivateKey.fromRandom();
      const senderMaster = new Uint8Array(Utils.toArray(senderKey.toHex(), 'hex'));
      const recipient = PrivateKey.fromRandom();
      const outpointA = { txid: 'a'.repeat(64), vout: 0, satoshis: 10_000, height: 100 };

      const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (isChallengeRequest(url)) return challengeResponse();
        if (url.includes('/utxos/')) {
          // WhatsOnChain keeps listing outpoint A even after it was spent, and never
          // lists the new change output either (mw-1589l.28).
          return new Response(JSON.stringify({ utxos: [outpointA] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
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

      const sendParams = {
        class: 'message' as const,
        senderKey: senderMaster,
        recipientPublicKeyHex: recipient.toPublicKey().toString(),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      };

      const firstTxid = await sendTextMessage({ ...sendParams, text: 'first' });
      const secondTxid = await sendTextMessage({ ...sendParams, text: 'second' });

      expect(secondTxid).toMatch(/^[0-9a-f]{64}$/);
      expect(secondTxid).not.toBe(firstTxid);

      const broadcastCalls = fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/broadcast'));
      expect(broadcastCalls).toHaveLength(2);
      const secondRawtx = (JSON.parse(String(broadcastCalls[1][1]?.body)) as { rawtx: string }).rawtx;
      const secondTx = Transaction.fromHex(secondRawtx);

      expect(secondTx.inputs).toHaveLength(1);
      expect(secondTx.inputs[0].sourceTXID).toBe(firstTxid);
      expect(secondTx.inputs[0].sourceOutputIndex).toBe(2);
      expect(
        secondTx.inputs.some((i) => i.sourceTXID === outpointA.txid && i.sourceOutputIndex === outpointA.vout),
      ).toBe(false);
    });

    it('AC2: forgets a remembered spent outpoint once the unspent list no longer carries it', async () => {
      const senderKey = PrivateKey.fromRandom();
      const senderMaster = new Uint8Array(Utils.toArray(senderKey.toHex(), 'hex'));
      const recipient = PrivateKey.fromRandom();
      const outpointA = { txid: 'a'.repeat(64), vout: 0, satoshis: 10_000, height: 100 };
      let firstTxid = '';
      let secondUtxosServed = false;

      const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (isChallengeRequest(url)) return challengeResponse();
        if (url.includes('/utxos/')) {
          if (!secondUtxosServed && firstTxid) {
            // WhatsOnChain has caught up: A is gone and the change output now shows.
            secondUtxosServed = true;
            return new Response(
              JSON.stringify({ utxos: [{ txid: firstTxid, vout: 2, satoshis: 9_800, height: 0 }] }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          return new Response(JSON.stringify({ utxos: [outpointA] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.endsWith('/broadcast')) {
          const body = JSON.parse(String(init?.body)) as { rawtx: string };
          const tx = Transaction.fromHex(body.rawtx);
          const txid = tx.id('hex');
          if (!firstTxid) firstTxid = txid;
          return new Response(JSON.stringify({ txid }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      });

      const sendParams = {
        class: 'message' as const,
        senderKey: senderMaster,
        recipientPublicKeyHex: recipient.toPublicKey().toString(),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      };

      await sendTextMessage({ ...sendParams, text: 'first' });
      expect(await db.pendingSpends.get(firstTxid)).toBeDefined();

      await sendTextMessage({ ...sendParams, text: 'second' });

      expect(await db.pendingSpends.get(firstTxid)).toBeUndefined();
    });

    it('AC2: forgets a remembered spent outpoint after 24 hours even if the list still carries it', async () => {
      const senderKey = PrivateKey.fromRandom();
      const senderMaster = new Uint8Array(Utils.toArray(senderKey.toHex(), 'hex'));
      const recipient = PrivateKey.fromRandom();
      const outpointA = { txid: 'a'.repeat(64), vout: 0, satoshis: 10_000, height: 100 };

      await db.pendingSpends.put({
        txid: 'b'.repeat(64),
        outpoints: [outpointKey(outpointA)],
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      });

      const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (isChallengeRequest(url)) return challengeResponse();
        if (url.includes('/utxos/')) {
          return new Response(JSON.stringify({ utxos: [outpointA] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.endsWith('/broadcast')) {
          const body = JSON.parse(String(init?.body)) as { rawtx: string };
          return new Response(JSON.stringify({ txid: Transaction.fromHex(body.rawtx).id('hex') }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      });

      await sendTextMessage({
        text: 'hello',
        class: 'message',
        senderKey: senderMaster,
        recipientPublicKeyHex: recipient.toPublicKey().toString(),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      const broadcastCall = fetchImpl.mock.calls.find(([url]) => String(url).endsWith('/broadcast'));
      const rawtx = (JSON.parse(String(broadcastCall![1]?.body)) as { rawtx: string }).rawtx;
      const tx = Transaction.fromHex(rawtx);
      expect(tx.inputs.some((i) => i.sourceTXID === outpointA.txid && i.sourceOutputIndex === outpointA.vout)).toBe(
        true,
      );
      expect(await db.pendingSpends.get('b'.repeat(64))).toBeUndefined();
    });
  });

  describe('chained pending spends (mw-tfne4.33)', () => {
    it('AC1: keeps a chained pending entry alive even when the backend has not yet listed its input, so a later send never respends it', async () => {
      const senderKey = PrivateKey.fromRandom();
      const senderMaster = new Uint8Array(Utils.toArray(senderKey.toHex(), 'hex'));
      const recipient = PrivateKey.fromRandom();

      const outpointX = { txid: 'a'.repeat(64), vout: 0, satoshis: 10_000, height: 100 };
      const txidA = 'b'.repeat(64);
      const txidB = 'c'.repeat(64);
      const changeC = { txid: txidA, vout: 2, satoshis: 9_800 };
      const changeD = { txid: txidB, vout: 2, satoshis: 9_600 };

      // Entry A spent X and produced change C; entry B spent C and produced change D.
      // Neither A nor B has confirmed, so WhatsOnChain still lists only the original
      // coin X — it never lists C (A's change) or D (B's change) at all.
      await db.pendingSpends.put({
        txid: txidA,
        outpoints: [outpointKey(outpointX)],
        createdAt: new Date(),
        changeOutpoint: changeC,
      });
      await db.pendingSpends.put({
        txid: txidB,
        outpoints: [outpointKey(changeC)],
        createdAt: new Date(),
        changeOutpoint: changeD,
      });

      const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (isChallengeRequest(url)) return challengeResponse();
        if (url.includes('/utxos/')) {
          return new Response(JSON.stringify({ utxos: [outpointX] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
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

      await sendTextMessage({
        text: 'third',
        class: 'message',
        senderKey: senderMaster,
        recipientPublicKeyHex: recipient.toPublicKey().toString(),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      const broadcastCall = fetchImpl.mock.calls.find(([url]) => String(url).endsWith('/broadcast'));
      expect(broadcastCall).toBeDefined();
      const rawtx = (JSON.parse(String(broadcastCall![1]?.body)) as { rawtx: string }).rawtx;
      const tx = Transaction.fromHex(rawtx);

      expect(tx.inputs).toHaveLength(1);
      expect(tx.inputs[0].sourceTXID).toBe(txidB);
      expect(tx.inputs[0].sourceOutputIndex).toBe(2);
      expect(
        tx.inputs.some((i) => i.sourceTXID === outpointX.txid && i.sourceOutputIndex === outpointX.vout),
      ).toBe(false);
      expect(tx.inputs.some((i) => i.sourceTXID === txidA && i.sourceOutputIndex === 2)).toBe(false);
    });

    it('AC2: never names the same outpoint twice among the inputs, even when the backend lists it twice', async () => {
      const senderKey = PrivateKey.fromRandom();
      const senderMaster = new Uint8Array(Utils.toArray(senderKey.toHex(), 'hex'));
      const recipient = PrivateKey.fromRandom();
      const outpointY = { txid: 'd'.repeat(64), vout: 1, satoshis: 10_000, height: 100 };

      const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (isChallengeRequest(url)) return challengeResponse();
        if (url.includes('/utxos/')) {
          return new Response(JSON.stringify({ utxos: [outpointY, outpointY] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
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

      await sendTextMessage({
        text: 'hello',
        class: 'message',
        senderKey: senderMaster,
        recipientPublicKeyHex: recipient.toPublicKey().toString(),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      const broadcastCall = fetchImpl.mock.calls.find(([url]) => String(url).endsWith('/broadcast'));
      const rawtx = (JSON.parse(String(broadcastCall![1]?.body)) as { rawtx: string }).rawtx;
      const tx = Transaction.fromHex(rawtx);
      const keys = tx.inputs.map((i) => `${i.sourceTXID}:${i.sourceOutputIndex}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect(tx.inputs).toHaveLength(1);
    });

    it('AC2: never names a pending entry\'s change outpoint twice when the backend already lists it too', async () => {
      const senderKey = PrivateKey.fromRandom();
      const senderMaster = new Uint8Array(Utils.toArray(senderKey.toHex(), 'hex'));
      const recipient = PrivateKey.fromRandom();
      const outpointX = { txid: 'e'.repeat(64), vout: 0, satoshis: 10_000, height: 100 };
      const txidA = 'f'.repeat(64);
      const changeC = { txid: txidA, vout: 2, satoshis: 9_800 };

      await db.pendingSpends.put({
        txid: txidA,
        outpoints: [outpointKey(outpointX)],
        createdAt: new Date(),
        changeOutpoint: changeC,
      });

      const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (isChallengeRequest(url)) return challengeResponse();
        if (url.includes('/utxos/')) {
          // The backend still lists X (not yet caught up removing it) but has also
          // started listing entry A's own change C as unspent.
          return new Response(
            JSON.stringify({ utxos: [outpointX, { txid: changeC.txid, vout: changeC.vout, satoshis: changeC.satoshis, height: 0 }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
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

      await sendTextMessage({
        text: 'hello',
        class: 'message',
        senderKey: senderMaster,
        recipientPublicKeyHex: recipient.toPublicKey().toString(),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      const broadcastCall = fetchImpl.mock.calls.find(([url]) => String(url).endsWith('/broadcast'));
      const rawtx = (JSON.parse(String(broadcastCall![1]?.body)) as { rawtx: string }).rawtx;
      const tx = Transaction.fromHex(rawtx);
      const keys = tx.inputs.map((i) => `${i.sourceTXID}:${i.sourceOutputIndex}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect(tx.inputs.some((i) => i.sourceTXID === changeC.txid && i.sourceOutputIndex === changeC.vout)).toBe(
        true,
      );
    });
  });
});
