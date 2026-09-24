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
  createChainProvider,
  findTypedRecordsInTransaction,
  type ChainProvider,
  type TypedRecordInTransaction,
} from 'spell-forge-bsv';
import { settingsRepo } from '../data/repositories';

const LICENCE_STATUS_SETTING_KEY = 'licence-status';

export interface LicenceOutpoint {
  txid: string;
  vout: number;
}

export type LicenceStatus =
  | { held: true; outpoint: LicenceOutpoint; checkedAt: string }
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
 * Walks the key's own address history for a mint record naming it holder of this
 * build's collection, then checks no later transfer record moves that origin away.
 * The License token itself is always output 0 of its mint transaction (the shape
 * every builder in the package writes), so the origin is the mint's txid at vout 0.
 */
export async function findLicence(
  publicKeyHex: string,
  provider: ChainProvider = createChainProvider(),
): Promise<LicenceOutpoint | null> {
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

  let origin: LicenceOutpoint | null = null;
  const transferredOrigins = new Set<string>();

  for (const entry of history) {
    const txHex = await provider.getTransactionHex(entry.txid);
    for (const record of findTypedRecordsInTransaction(txHex)) {
      const payload = decodeTypedPayload(record);
      if (!payload) continue;
      if (payload.kind === 'mint' && payload.collection === chainConfig.collectionId && payload.holder === address) {
        origin = { txid: entry.txid, vout: 0 };
      } else if (payload.kind === 'transfer') {
        transferredOrigins.add(payload.origin);
      }
    }
  }

  if (!origin) return null;
  return transferredOrigins.has(`${origin.txid}:${origin.vout}`) ? null : origin;
}

export async function getCachedLicenceStatus(): Promise<LicenceStatus | undefined> {
  return (await settingsRepo.get(LICENCE_STATUS_SETTING_KEY)) as LicenceStatus | undefined;
}

/** Checks the chain and caches the answer (with the time it was checked). */
export async function checkLicence(publicKeyHex: string, provider?: ChainProvider): Promise<LicenceStatus> {
  const outpoint = await findLicence(publicKeyHex, provider);
  const checkedAt = new Date().toISOString();
  const status: LicenceStatus = outpoint ? { held: true, outpoint, checkedAt } : { held: false, checkedAt };
  await settingsRepo.set(LICENCE_STATUS_SETTING_KEY, status);
  return status;
}
