// features/steps/pending-spends.steps.ts — runs features/pending-spends.feature under
// vitest via @amiceli/vitest-cucumber. Exercises sendTextMessage (src/services/send.ts)
// directly, the same way fixture.steps.ts exercises a service function without a screen.
import { expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey, Transaction, Utils } from '@bsv/sdk';
import { sendTextMessage } from '../../src/services/send';
import { db } from '../../src/data/db';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

const feature = await loadFeature('features/pending-spends.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario(
    'AC3: two messages sent within a minute both broadcast without a mempool conflict',
    ({ Given, When, Then, And }) => {
      const senderKey = PrivateKey.fromRandom();
      const senderMaster = new Uint8Array(Utils.toArray(senderKey.toHex(), 'hex'));
      const recipient = PrivateKey.fromRandom();
      const coin = { txid: 'c'.repeat(64), vout: 0, satoshis: 10_000, height: 100 };

      let fetchImpl: ReturnType<typeof vi.fn>;
      let firstTxid: string;
      let secondTxid: string;

      Given('the backend has one spendable coin and a stale unspent list that never drops it', async () => {
        await db.pendingSpends.clear();
        fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (isChallengeRequest(url)) return challengeResponse();
          if (url.includes('/utxos/')) {
            // WhatsOnChain keeps listing this coin as unspent even once a broadcast of
            // ours has spent it, and never shows the change output either.
            return new Response(JSON.stringify({ utxos: [coin] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (url.endsWith('/broadcast')) {
            const body = JSON.parse(String(init?.body)) as { rawtx: string };
            const txid = Transaction.fromHex(body.rawtx).id('hex');
            return new Response(JSON.stringify({ txid }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          throw new Error(`unexpected fetch: ${url}`);
        });
      });

      When('two messages are sent one after another', async () => {
        const sendParams = {
          class: 'message' as const,
          senderKey: senderMaster,
          recipientPublicKeyHex: recipient.toPublicKey().toString(),
          fetchImpl: fetchImpl as unknown as typeof fetch,
        };
        firstTxid = await sendTextMessage({ ...sendParams, text: 'what do you need from me to go forward' });
        secondTxid = await sendTextMessage({ ...sendParams, text: 'following up' });
      });

      Then('both broadcasts succeed with different transaction ids', () => {
        expect(firstTxid).toMatch(/^[0-9a-f]{64}$/);
        expect(secondTxid).toMatch(/^[0-9a-f]{64}$/);
        expect(secondTxid).not.toBe(firstTxid);
      });

      And('the second transaction does not spend the coin the first transaction already spent', () => {
        const broadcastCalls = fetchImpl.mock.calls.filter(([url]: [RequestInfo | URL]) =>
          String(url).endsWith('/broadcast'),
        );
        expect(broadcastCalls).toHaveLength(2);
        const secondRawtx = (JSON.parse(String(broadcastCalls[1][1]?.body)) as { rawtx: string }).rawtx;
        const secondTx = Transaction.fromHex(secondRawtx);
        expect(
          secondTx.inputs.some((i) => i.sourceTXID === coin.txid && i.sourceOutputIndex === coin.vout),
        ).toBe(false);
        expect(secondTx.inputs[0].sourceTXID).toBe(firstTxid);
      });
    },
  );
});
