// src/services/issue.ts — the issuer's side of a licence (docs/protocol.md §16, §19): mint a
// License to another key in a chosen collection, end one with a revoke record, and list what
// this key issued. Funded by the unlocked key's own coins, listed and broadcast through the
// backend exactly as a message is (spendable.ts) — the chain provider is asked only to read
// (source transactions for the builder, address history), never to broadcast.
//
// The mint is spell-forge-bsv's contract-locked builder used directly, as mint.ts does for
// the self-mint; that file is left as it is.
import { P2PKH, PrivateKey, PublicKey, SatoshisPerKilobyte, Transaction, Utils } from '@bsv/sdk';
import {
  buildContractMintTransaction,
  chainConfig,
  encodeTypedRecordScript,
  findTypedRecordsInTransaction,
  isValidCompressedPublicKeyHex,
  outpointKey,
  selectFeeUtxos,
  type ChainProvider,
  type Utxo,
} from 'spell-forge-bsv';
import { pendingSpendsRepo } from '../data/repositories';
import type { ApiFetchOptions } from './apiAuth';
import { sharedChainReads } from './sharedChainReads';
import { addressForPublicKey } from './licence';
import { busyOf, providerRefusal, retryWhenBusy, type Busy } from './chainBusy';
import { ANCHOR_ADDRESS } from './messages';
import { mintCostSatoshis } from './mint';
import { broadcastThroughBackend, loadSpendableUtxos } from './spendable';

const TESTNET_WIF_PREFIX = [0xef];
const ANCHOR_OUTPUT_SATOSHIS = 1;
/** buildContractMintTransaction's outputs: [0] License, [1] Fuel, [2] type-M record, [3] change. */
const MINT_CHANGE_VOUT = 3;
/** revokeLicence's outputs: [0] the W record, [1] the anchor, [2] change (as send.ts). */
const REVOKE_CHANGE_VOUT = 2;
const ORIGIN_SHAPE = /^[0-9a-f]{64}:\d+$/;
export type IssueErrorCode = 'invalid-key' | 'own-key' | 'not-issued' | 'insufficient-funds' | 'network';

/** A refusal the screen can show as it stands: `message` is plain words, `code` says which kind. */
export class IssueError extends Error {
  readonly code: IssueErrorCode;
  constructor(code: IssueErrorCode, message: string) {
    super(message);
    this.name = 'IssueError';
    this.code = code;
  }
}

export interface IssueContext {
  /** The issuer's raw 32-byte master key, as unlocked from the vault. */
  issuerKey: Uint8Array;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

export interface IssueLicenceParams extends IssueContext {
  holderPublicKeyHex: string;
  collection: string;
  /** Reads source transactions for the mint builder; never asked to broadcast. */
  provider?: ChainProvider;
  /** Called each time WhatsOnChain is busy and the step is about to be tried again, so the screen can say so. */
  onBusy?: () => void;
}

export interface IssuedLicence {
  txid: string;
  /** The License token's outpoint: `txid:0`. */
  origin: string;
  collection: string;
  /** The holder's testnet address, as the mint record names it. */
  holder: string;
}

export interface RevokeLicenceParams extends IssueContext {
  /** The mint output to end, `txid:vout`. */
  origin: string;
  /** Reads this key's mints to check the origin is one of them; never asked to broadcast. */
  provider?: ChainProvider;
}

export interface IssueCost {
  fuelSatoshis: number;
  feeEstimateSatoshis: number;
  /** What a balance must reach before a mint can be built. */
  totalSatoshis: number;
}

export interface IssuedLicenceEntry extends IssuedLicence {
  /** The block the mint is in; null while it is still unconfirmed. */
  height: number | null;
  revoked: boolean;
}

function apiOptionsOf(context: IssueContext): ApiFetchOptions {
  return { unlockedKey: context.issuerKey, apiBase: context.apiBase, fetchImpl: context.fetchImpl };
}

function privateKeyOf(issuerKey: Uint8Array): PrivateKey {
  return PrivateKey.fromHex(Utils.toHex(Array.from(issuerKey)));
}

function networkError(error: unknown): IssueError {
  if (error instanceof IssueError) return error;
  const message = error instanceof Error && error.message ? error.message : 'The network could not be reached.';
  return new IssueError('network', message);
}

/**
 * The words for WhatsOnChain being busy or refusing, in place of its own page: what the Governor needs is whether anything
 * was spent. Before the broadcast nothing was; at it, a 429 was turned away before the transaction was looked at, but a 5xx
 * (or a lost connection) may have come after it went out. The provider's body goes to the console only (mw-rch8bu).
 */
function busyMessage(busy: Busy, broadcasting: boolean): string {
  if (broadcasting && busy.kind !== 'rate-limited') {
    const answered = busy.status ? ` (it answered ${busy.status})` : '';
    return `WhatsOnChain had trouble taking the licence${answered}, so it may have gone out. Check Issued licences below in a minute, before you issue it again.`;
  }
  if (busy.kind === 'rate-limited') return 'WhatsOnChain is rate-limiting us. Nothing was spent. Try again in a minute.';
  if (busy.kind === 'unreachable') return 'WhatsOnChain could not be reached. Nothing was spent. Try again in a minute.';
  return `WhatsOnChain is having trouble (it answered ${busy.status}). Nothing was spent. Try again in a minute.`;
}

/** `error` as it came, unless it carries WhatsOnChain's own refusal: then a plain IssueError, and the refusal's body to the console. */
function plainRefusal(error: unknown, broadcasting: boolean): unknown {
  const message = error instanceof Error ? error.message : '';
  const busy = busyOf(error);
  const refusal = providerRefusal(message);
  if (!busy && !refusal) return error;
  console.warn('WhatsOnChain refused a request while issuing a licence:', message);
  if (busy) return new IssueError('network', busyMessage(busy, broadcasting));
  // A plain 500 at the broadcast is not "busy", but it may still have come after the transaction went out.
  if (broadcasting && refusal && refusal.status >= 500) {
    return new IssueError('network', `WhatsOnChain had trouble taking the licence (it answered ${refusal.status}), so it may have gone out. Check Issued licences below in a minute, before you issue it again.`);
  }
  return new IssueError('network', `WhatsOnChain refused it (it answered ${refusal?.status}). Nothing was spent.`);
}

function notEnoughSats(needed: number, held: number): IssueError {
  return new IssueError(
    'insufficient-funds',
    `Not enough sats: this needs about ${needed} and this key holds ${held}. Fund the key and try again.`,
  );
}

function sumSatoshis(utxos: Utxo[]): number {
  return selectFeeUtxos(utxos, { exclude: [] }).reduce((sum, utxo) => sum + utxo.satoshis, 0);
}

/** A ChainProvider whose failures are network errors, so a builder's own refusals stay distinct. */
function withNetworkErrors(provider: ChainProvider): ChainProvider {
  const wrapped: ChainProvider = {
    getUtxos: (address) => provider.getUtxos(address).catch((e) => Promise.reject(networkError(e))),
    getTransactionHex: (txid) => provider.getTransactionHex(txid).catch((e) => Promise.reject(networkError(e))),
    broadcast: (hex) => provider.broadcast(hex).catch((e) => Promise.reject(networkError(e))),
    getAddressHistory: (address) => provider.getAddressHistory(address).catch((e) => Promise.reject(networkError(e))),
  };
  if (provider.getUnconfirmedAddressHistory) {
    wrapped.getUnconfirmedAddressHistory = (address) =>
      provider.getUnconfirmedAddressHistory!(address).catch((e) => Promise.reject(networkError(e)));
  }
  return wrapped;
}

/**
 * What a mint costs, for the screen: the Fuel it locks, the fee estimate (with the smallest
 * change the SDK will keep, mint.ts's margin), and the balance that covers both.
 */
export function issueCost(): IssueCost {
  const fuelSatoshis = chainConfig.mintFuelSatoshis ?? 0;
  const totalSatoshis = mintCostSatoshis(chainConfig);
  // mintCostSatoshis is the Fuel, the 1-sat License, and the fee margin.
  return { fuelSatoshis, feeEstimateSatoshis: totalSatoshis - fuelSatoshis - 1, totalSatoshis };
}

/** The issuer's spendable balance, as the backend lists it (less what a pending send spent). */
export async function fetchIssuerBalance(context: IssueContext): Promise<number> {
  try {
    const address = privateKeyOf(context.issuerKey).toAddress(chainConfig.network);
    return sumSatoshis(await loadSpendableUtxos(address, apiOptionsOf(context)));
  } catch (error) {
    throw networkError(error);
  }
}

/**
 * Mints a License to `holderPublicKeyHex` in `collection`, funded by this key. Refuses an
 * invalid key, this key's own, and a balance too small, all before anything is broadcast
 * (the first two before anything is fetched). Resolves once the backend has broadcast it.
 */
export async function issueLicence(params: IssueLicenceParams): Promise<IssuedLicence> {
  const holderPublicKeyHex = params.holderPublicKeyHex.trim().toLowerCase();
  if (!isValidCompressedPublicKeyHex(holderPublicKeyHex)) {
    throw new IssueError('invalid-key', 'That is not a public key: it should be 66 hex characters starting 02 or 03.');
  }
  const issuerPrivateKey = privateKeyOf(params.issuerKey);
  if (issuerPrivateKey.toPublicKey().toString() === holderPublicKeyHex) {
    throw new IssueError('own-key', 'That is your own key. A licence for yourself is minted from the Key screen.');
  }
  const collection = params.collection.trim();
  if (!collection) throw new IssueError('invalid-key', 'Choose a collection to issue the licence in.');

  const apiOptions = apiOptionsOf(params);
  const issuerAddress = issuerPrivateKey.toAddress(chainConfig.network);
  const cost = issueCost();

  let utxos: Utxo[];
  try {
    utxos = await retryWhenBusy(() => loadSpendableUtxos(issuerAddress, apiOptions), params.onBusy);
  } catch (error) {
    throw networkError(plainRefusal(error, false));
  }
  const held = sumSatoshis(utxos);
  if (held < cost.totalSatoshis) throw notEnoughSats(cost.totalSatoshis, held);

  let built: Awaited<ReturnType<typeof buildContractMintTransaction>>;
  try {
    built = await retryWhenBusy(
      () =>
        buildContractMintTransaction({
          issuerKey: issuerPrivateKey.toWif(TESTNET_WIF_PREFIX),
          utxos,
          holderPubKey: holderPublicKeyHex,
          mintFuelSatoshis: chainConfig.mintFuelSatoshis,
          config: { ...chainConfig, collectionId: collection },
          // Read through the one paced queue: the builder's reads of the coins' source transactions ran on a
          // provider of their own, beside the list the last issue had started, at twice WhatsOnChain's limit.
          provider: withNetworkErrors(params.provider ?? sharedChainReads()),
        }),
      params.onBusy,
    );
  } catch (caught) {
    const error = plainRefusal(caught, false);
    if (error instanceof IssueError) throw error;
    if (error instanceof Error && /not enough satoshis|no utxos/i.test(error.message)) throw notEnoughSats(cost.totalSatoshis, held);
    throw error;
  }

  const now = new Date();
  let txid: string;
  try {
    // Only a 429 is sent again: the provider turned it away unread. After a 5xx the transaction may be out already.
    txid = await retryWhenBusy(() => broadcastThroughBackend(built.hex, apiOptions), params.onBusy, (busy) => busy.kind === 'rate-limited');
  } catch (error) {
    throw networkError(plainRefusal(error, true));
  }
  const change = built.transaction.outputs[MINT_CHANGE_VOUT];
  await pendingSpendsRepo.add({
    txid,
    outpoints: built.spentOutpoints.map(outpointKey),
    createdAt: now,
    changeOutpoint: change?.satoshis === undefined ? undefined : { txid, vout: MINT_CHANGE_VOUT, satoshis: change.satoshis },
  });

  return {
    txid,
    origin: `${txid}:0`,
    collection,
    holder: PublicKey.fromString(holderPublicKeyHex).toAddress(chainConfig.network),
  };
}

/**
 * Ends the licence whose mint output is `origin`: a transaction from this key with one
 * typed W record `{kind: 'revoke', origin}`, the 1-sat anchor and change — the shape
 * sendTextMessage writes, funded and broadcast the same way (docs/protocol.md §16).
 * Refuses, before any coin is fetched or anything signed, an origin that is not one of
 * this key's own mints (it would cost a fee and revoke nothing).
 */
export async function revokeLicence(params: RevokeLicenceParams): Promise<{ txid: string }> {
  const origin = params.origin.trim();
  if (!ORIGIN_SHAPE.test(origin)) {
    throw new IssueError('invalid-key', 'A licence origin looks like a transaction id, a colon, and an output number.');
  }
  const apiOptions = apiOptionsOf(params);
  const privateKey = privateKeyOf(params.issuerKey);
  const address = privateKey.toAddress(chainConfig.network);

  const mine = await issuedLicences({
    issuerPublicKeyHex: privateKey.toPublicKey().toString(),
    provider: params.provider,
  });
  if (!mine.some((mint) => mint.origin === origin)) {
    throw new IssueError('not-issued', 'That licence is not one you issued.');
  }

  let utxos: Utxo[];
  try {
    utxos = await loadSpendableUtxos(address, apiOptions);
  } catch (error) {
    throw networkError(error);
  }
  const eligible = selectFeeUtxos(utxos, { exclude: [] });
  const held = eligible.reduce((sum, utxo) => sum + utxo.satoshis, 0);
  // The record is free; the anchor is 1 sat and the fee of a small transaction a few more.
  const needed = ANCHOR_OUTPUT_SATOSHIS + 1;

  const lockingScript = new P2PKH().lock(address);
  const transaction = new Transaction();
  for (const utxo of eligible) {
    const sourceTransaction = new Transaction();
    sourceTransaction.outputs[utxo.vout] = { satoshis: utxo.satoshis, lockingScript };
    transaction.addInput({
      sourceTransaction,
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: new P2PKH().unlock(privateKey),
    });
  }
  const payload = Utils.toArray(JSON.stringify({ kind: 'revoke', origin }), 'utf8');
  transaction.addOutput({ lockingScript: encodeTypedRecordScript('W', payload), satoshis: 0 });
  transaction.addP2PKHOutput(ANCHOR_ADDRESS, ANCHOR_OUTPUT_SATOSHIS);
  transaction.addP2PKHOutput(address);
  if (eligible.length === 0) throw notEnoughSats(needed, held);
  await transaction.fee(new SatoshisPerKilobyte(chainConfig.feeRateSatPerKb));
  const change = transaction.outputs[REVOKE_CHANGE_VOUT];
  if (!change || change.satoshis === undefined) throw notEnoughSats(needed, held);
  await transaction.sign();

  const now = new Date();
  let txid: string;
  try {
    txid = await broadcastThroughBackend(transaction.toHex(), apiOptions);
  } catch (error) {
    throw networkError(error);
  }
  await pendingSpendsRepo.add({
    txid,
    outpoints: eligible.map(outpointKey),
    createdAt: now,
    changeOutpoint: { txid, vout: REVOKE_CHANGE_VOUT, satoshis: change.satoshis },
  });
  return { txid };
}

function signedBy(transaction: Transaction, publicKeyHex: string): boolean {
  return transaction.inputs.some((input) =>
    (input.unlockingScript?.chunks ?? []).some((chunk) => chunk.data !== undefined && Utils.toHex(chunk.data) === publicKeyHex),
  );
}

function parsePayload(payloadBytes: number[]): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(Utils.toUTF8(payloadBytes));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The licences this key issued, newest first (unconfirmed, then by block). Walks the key's
 * own address history (the whole confirmed history, paged) — the mint it funded and the revokes it wrote both appear there —
 * and keeps only transactions this key signed (a scriptSig that pushes its public key),
 * so a mint someone else made naming this address is not listed. A mint is `revoked` when a
 * revoke record this key signed names its origin.
 */
export async function issuedLicences(
  params: {
    issuerPublicKeyHex: string;
    provider?: ChainProvider;
  },
): Promise<IssuedLicenceEntry[]> {
  const provider = withNetworkErrors(params.provider ?? sharedChainReads());
  const address = addressForPublicKey(params.issuerPublicKeyHex);
  const [confirmed, unconfirmed] = await Promise.all([
    provider.getAddressHistory(address),
    provider.getUnconfirmedAddressHistory ? provider.getUnconfirmedAddressHistory(address) : Promise.resolve([]),
  ]);

  const seenTxids = new Set<string>();
  const history = [...confirmed, ...unconfirmed].filter((entry) => {
    if (seenTxids.has(entry.txid)) return false;
    seenTxids.add(entry.txid);
    return true;
  });

  const mints: Array<IssuedLicenceEntry & { position: number }> = [];
  const revokedOrigins = new Set<string>();
  for (const [position, entry] of history.entries()) {
    const txHex = await provider.getTransactionHex(entry.txid);
    if (!signedBy(Transaction.fromHex(txHex), params.issuerPublicKeyHex)) continue;
    for (const record of findTypedRecordsInTransaction(txHex)) {
      const payload = parsePayload(record.payloadBytes);
      if (!payload) continue;
      if (record.recordType === 'M' && typeof payload.collection === 'string' && typeof payload.holder === 'string') {
        mints.push({
          txid: entry.txid,
          origin: `${entry.txid}:0`,
          collection: payload.collection,
          holder: payload.holder,
          height: entry.height !== undefined && entry.height > 0 ? entry.height : null,
          revoked: false,
          position,
        });
      } else if (record.recordType === 'W' && payload.kind === 'revoke' && typeof payload.origin === 'string') {
        revokedOrigins.add(payload.origin.toLowerCase());
      }
    }
  }

  const heightRank = (height: number | null) => height ?? Number.POSITIVE_INFINITY;
  return mints
    .sort((a, b) => heightRank(b.height) - heightRank(a.height) || b.position - a.position)
    .map((mint) => ({
      txid: mint.txid,
      origin: mint.origin,
      collection: mint.collection,
      holder: mint.holder,
      height: mint.height,
      revoked: revokedOrigins.has(mint.origin.toLowerCase()),
    }));
}
