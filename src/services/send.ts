// src/services/send.ts — builds the tx docs/protocol.md §4 describes (one P2PKH
// input per UTXO, the record output, the 1-sat anchor payment, change), signs it
// with the unlocked key, and broadcasts it through the backend's own /api/broadcast
// (docs/api.md) — never talking to WhatsOnChain directly, the same reason
// spell-forge-bsv's ChainProvider exists, except the PWA has no ChainProvider of its
// own and goes through the backend's proxy endpoints instead.
import { P2PKH, PrivateKey, SatoshisPerKilobyte, Transaction, Utils } from '@bsv/sdk';
import { chainConfig, encodeRecordScript, selectFeeUtxos, type Utxo } from 'spell-forge-bsv';
import { ANCHOR_ADDRESS, API_BASE, encryptMessage, type MessageClass } from './messages';

const ANCHOR_OUTPUT_SATOSHIS = 1;

export interface SendMessageParams {
  text: string;
  class: MessageClass;
  /** The sender's raw 32-byte master key, as unlocked from the vault. */
  senderKey: Uint8Array;
  recipientPublicKeyHex: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Encrypts and sends a text message to `recipientPublicKeyHex`: fetches the
 * sender's UTXOs, builds and signs the record transaction, and broadcasts it.
 * Resolves with the txid, or throws a readable error and broadcasts nothing.
 */
export async function sendTextMessage(params: SendMessageParams): Promise<string> {
  const apiBase = params.apiBase ?? API_BASE;
  const fetchImpl = params.fetchImpl ?? fetch;

  const senderPrivateKeyHex = Utils.toHex(Array.from(params.senderKey));
  const privateKey = PrivateKey.fromHex(senderPrivateKeyHex);
  const address = privateKey.toAddress(chainConfig.network);

  const payload = encryptMessage({
    text: params.text,
    class: params.class,
    senderPrivateKeyHex,
    recipientPublicKeyHex: params.recipientPublicKeyHex,
  });

  const utxosResponse = await fetchImpl(`${apiBase}/utxos/${address}`);
  if (!utxosResponse.ok) {
    throw new Error(await readErrorMessage(utxosResponse, 'Could not fetch spendable coins.'));
  }
  const { utxos } = (await utxosResponse.json()) as { utxos: Utxo[] };
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

  const broadcastResponse = await fetchImpl(`${apiBase}/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawtx: transaction.toHex() }),
  });
  if (!broadcastResponse.ok) {
    throw new Error(await readErrorMessage(broadcastResponse, 'The backend rejected the broadcast.'));
  }
  const broadcastBody = (await broadcastResponse.json()) as { txid?: unknown };
  if (typeof broadcastBody.txid !== 'string') {
    throw new Error('The broadcast succeeded but returned no transaction id.');
  }
  return broadcastBody.txid;
}
