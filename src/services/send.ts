// src/services/send.ts — builds the tx docs/protocol.md §4 describes (one P2PKH
// input per UTXO, the record output, the 1-sat anchor payment, change), signs it
// with the unlocked key, and broadcasts it through the backend's own /api/broadcast
// (docs/api.md) — not talking to WhatsOnChain directly, the same reason
// spell-forge-bsv's ChainProvider exists, except the PWA has no ChainProvider of its
// own and goes through the backend's proxy endpoints instead. The one exception is
// `via: 'whatsonchain'` (docs/protocol.md §21): a text post whose backend cannot be
// reached lists coins and broadcasts at WhatsOnChain itself.
import { P2PKH, PrivateKey, SatoshisPerKilobyte, Transaction, Utils } from '@bsv/sdk';
import {
  chainConfig,
  encodeRecordScript,
  outpointKey,
  selectFeeUtxos,
} from 'spell-forge-bsv';
import { broadcastThroughBackend, loadSpendableUtxos, type ChainVia } from './spendable';
import { broadcastThroughWhatsOnChain } from './whatsonchain';
import { ANCHOR_ADDRESS, encryptMessage, type MessageClass } from './messages';
import { pendingSpendsRepo } from '../data/repositories';

const ANCHOR_OUTPUT_SATOSHIS = 1;

export interface SendMessageParams {
  text: string;
  class: MessageClass;
  /** The sender's raw 32-byte master key, as unlocked from the vault. */
  senderKey: Uint8Array;
  recipientPublicKeyHex: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
  /** Who lists the coins and takes the broadcast; the backend unless it cannot be reached. */
  via?: ChainVia;
}

/**
 * Encrypts and sends a text message to `recipientPublicKeyHex`: fetches the
 * sender's UTXOs, builds and signs the record transaction, and broadcasts it.
 * Resolves with the txid, or throws a readable error and broadcasts nothing.
 */
export async function sendTextMessage(params: SendMessageParams): Promise<string> {
  const apiOptions = { unlockedKey: params.senderKey, apiBase: params.apiBase, fetchImpl: params.fetchImpl };

  const senderPrivateKeyHex = Utils.toHex(Array.from(params.senderKey));
  const privateKey = PrivateKey.fromHex(senderPrivateKeyHex);
  const address = privateKey.toAddress(chainConfig.network);

  const payload = encryptMessage({
    text: params.text,
    class: params.class,
    senderPrivateKeyHex,
    recipientPublicKeyHex: params.recipientPublicKeyHex,
  });

  const now = new Date();
  const via = params.via ?? 'backend';
  const utxos = await loadSpendableUtxos(address, apiOptions, now, via);

  const eligibleUtxos = selectFeeUtxos(utxos, { exclude: [] });
  if (eligibleUtxos.length === 0) {
    throw new Error('No spendable coins available — fund this wallet before sending a message.');
  }

  const recordScript = encodeRecordScript(Utils.toArray(JSON.stringify(payload), 'utf8'));
  const lockingScript = new P2PKH().lock(address);

  const transaction = new Transaction();
  for (const utxo of eligibleUtxos) {
    const sourceTransaction = new Transaction();
    sourceTransaction.outputs[utxo.vout] = { satoshis: utxo.satoshis, lockingScript };
    transaction.addInput({
      sourceTransaction,
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: new P2PKH().unlock(privateKey),
    });
  }
  transaction.addOutput({ lockingScript: recordScript, satoshis: 0 });
  transaction.addP2PKHOutput(ANCHOR_ADDRESS, ANCHOR_OUTPUT_SATOSHIS);
  transaction.addP2PKHOutput(address);
  await transaction.fee(new SatoshisPerKilobyte(chainConfig.feeRateSatPerKb));
  if (transaction.outputs.length < 3 || transaction.outputs[2].satoshis === undefined) {
    throw new Error('Not enough satoshis to cover the anchor output and fee.');
  }
  await transaction.sign();

  const txid =
    via === 'whatsonchain'
      ? await broadcastThroughWhatsOnChain(transaction.toHex(), apiOptions.fetchImpl)
      : await broadcastThroughBackend(transaction.toHex(), apiOptions);

  await pendingSpendsRepo.add({
    txid,
    outpoints: eligibleUtxos.map(outpointKey),
    createdAt: now,
    changeOutpoint: { txid, vout: 2, satoshis: transaction.outputs[2].satoshis as number },
  });

  return txid;
}
