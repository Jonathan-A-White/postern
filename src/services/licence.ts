// src/services/licence.ts — checks whether a given key holds a License token, the
// way spell-forge's own nftgate protocol records it: a type-M ('mint') record naming
// the key's own testnet address as holder, with no later type-TR ('transfer') record
// moving that same origin away. Postern mints to its own key (issuer and holder at
// once, mw-1589l.3), so the mint transaction — funded and change-returned by the
// holder's own key — always appears in the holder's own address history; no separate
// anchor scan is needed the way a third-party buyer's purchase would need one.
//
// The result is cached in a Dexie settings row, with the time it was checked, so the
// gate can open on the last known answer while offline.
import { PublicKey, Utils } from '@bsv/sdk';
import {
  chainConfig,
  findTypedRecordsInTransaction,
  type ChainProvider,
  type TypedRecordInTransaction,
} from 'spell-forge-bsv';
import { settingsRepo } from '../data/repositories';
import { sharedChainReads } from './sharedChainReads';
import { COCKPIT_COLLECTION, LEGACY_LICENCE_COLLECTION } from './collections';

const COUNTED_COLLECTIONS = new Set([COCKPIT_COLLECTION, LEGACY_LICENCE_COLLECTION]);
const LICENCE_STATUS_SETTING_KEY = 'licence-status';
const LICENCE_MINT_PENDING_SETTING_KEY = 'licence-mint-pending';

export interface LicenceOutpoint {
  txid: string;
  vout: number;
}

/** A found licence: where its mint is, and the collection that mint names. */
export interface FoundLicence extends LicenceOutpoint {
  collection: string;
}

/** `collection` is absent on a row cached before it was recorded (mw-kiubh7.1): read such a
 * row as unknown and check afresh. */
export type LicenceStatus =
  | { held: true; outpoint: LicenceOutpoint; collection?: string; checkedAt: string }
  | { held: false; checkedAt: string };

interface MintPayload {
  kind: 'mint';
  collection: string;
  holder: string;
}

interface TransferPayload {
  kind: 'transfer';
  origin: string; // "txid:vout"
  to: string;
}

function decodeTypedPayload(record: TypedRecordInTransaction): MintPayload | TransferPayload | null {
  if (record.recordType !== 'M' && record.recordType !== 'TR') return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(Utils.toUTF8(record.payloadBytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (record.recordType === 'M' && typeof parsed.collection === 'string' && typeof parsed.holder === 'string') {
    return { kind: 'mint', collection: parsed.collection, holder: parsed.holder };
  }
  if (record.recordType === 'TR' && typeof parsed.origin === 'string' && typeof parsed.to === 'string') {
    return { kind: 'transfer', origin: parsed.origin, to: parsed.to };
  }
  return null;
}

/** The testnet address a License locked to this public key would show (spec R4.1.4). */
export function addressForPublicKey(publicKeyHex: string): string {
  return PublicKey.fromString(publicKeyHex).toAddress(chainConfig.network);
}

/**
 * Walks the key's own address history for a mint record naming it holder of the
 * cockpit collection (or the legacy one, see collections.ts), then checks no later
 * transfer record moves that origin away. A live mint in the cockpit collection wins over
 * one in the legacy collection whatever their order in the history; the result names the
 * collection it was found in.
 * The License token itself is always output 0 of its mint transaction (the shape
 * every builder in the package writes), so the origin is the mint's txid at vout 0.
 * The confirmed history is read whole, paged (confirmedHistory.ts), unless a provider is
 * handed in: the key broadcasts its own records, so a mint can lie past the newest 100. The
 * reads go through sharedChainReads.ts, so a transaction the Issued licences list has read is
 * not read again.
 */
export async function findLicence(publicKeyHex: string, handedProvider?: ChainProvider): Promise<FoundLicence | null> {
  const provider = handedProvider ?? sharedChainReads();
  const address = addressForPublicKey(publicKeyHex);
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

  const mints: FoundLicence[] = [];
  const transferredOrigins = new Set<string>();

  for (const entry of history) {
    const txHex = await provider.getTransactionHex(entry.txid);
    for (const record of findTypedRecordsInTransaction(txHex)) {
      const payload = decodeTypedPayload(record);
      if (!payload) continue;
      // LEGACY_LICENCE_COLLECTION is accepted only during the mw-6ww.63 transition, until he has re-minted in 'postern'.
      if (payload.kind === 'mint' && COUNTED_COLLECTIONS.has(payload.collection) && payload.holder === address) {
        mints.push({ txid: entry.txid, vout: 0, collection: payload.collection });
      } else if (payload.kind === 'transfer') {
        transferredOrigins.add(payload.origin);
      }
    }
  }

  // The latest live mint of each collection; the cockpit's wins over the legacy one.
  const live = mints.filter((mint) => !transferredOrigins.has(`${mint.txid}:${mint.vout}`));
  const latestIn = (collection: string) => live.filter((mint) => mint.collection === collection).at(-1);
  return latestIn(COCKPIT_COLLECTION) ?? latestIn(LEGACY_LICENCE_COLLECTION) ?? null;
}

export async function getCachedLicenceStatus(): Promise<LicenceStatus | undefined> {
  return (await settingsRepo.get(LICENCE_STATUS_SETTING_KEY)) as LicenceStatus | undefined;
}

export interface MintPending {
  txid: string;
  broadcastAt: string;
}

/** Recorded the moment a mint broadcasts, so the gate can say a licence is on its way
 * rather than "No licence found" while WhatsOnChain is still indexing it (mw-1589l.24). */
export async function setMintPending(txid: string): Promise<void> {
  const pending: MintPending = { txid, broadcastAt: new Date().toISOString() };
  await settingsRepo.set(LICENCE_MINT_PENDING_SETTING_KEY, pending);
}

export async function getMintPending(): Promise<MintPending | undefined> {
  return (await settingsRepo.get(LICENCE_MINT_PENDING_SETTING_KEY)) as MintPending | undefined;
}

async function clearMintPending(): Promise<void> {
  await settingsRepo.set(LICENCE_MINT_PENDING_SETTING_KEY, undefined);
}

/** Checks the chain and caches the answer (with the time it was checked). Clears any
 * mint-pending marker once the licence is found held in the cockpit's collection, so a later
 * failed check has nothing stale to fall back to (mw-1589l.24, mw-7ijx65). */
export async function checkLicence(publicKeyHex: string, provider?: ChainProvider): Promise<LicenceStatus> {
  const found = await findLicence(publicKeyHex, provider);
  const checkedAt = new Date().toISOString();
  const status: LicenceStatus = found
    ? { held: true, outpoint: { txid: found.txid, vout: found.vout }, collection: found.collection, checkedAt }
    : { held: false, checkedAt };
  await settingsRepo.set(LICENCE_STATUS_SETTING_KEY, status);
  // Only a licence in this collection ends the wait: a held licence in the old one is not the mint just sent.
  if (status.held && status.collection === COCKPIT_COLLECTION) await clearMintPending();
  return status;
}
