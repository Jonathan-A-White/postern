// src/services/spendable.ts — the two backend round-trips every transaction this app
// builds from its own key shares: which coins of that key are safe to spend (the backend's
// /api/utxos list, less what a still-unconfirmed send of ours already spent), and the
// broadcast through the backend's /api/broadcast. Lifted out of send.ts unchanged so a
// mint or a revoke funds and broadcasts exactly as a message does (mw-yjxcw.3).
import { outpointKey, filterUtxosExcludingPending, reconcilePendingSpends, type Utxo } from 'spell-forge-bsv';
import { apiFetch, type ApiFetchOptions } from './apiAuth';
import { fetchUtxosFromWhatsOnChain } from './whatsonchain';
import { pendingSpendsRepo } from '../data/repositories';

/** Where coins are listed and a transaction broadcast: the backend's /api routes, or WhatsOnChain itself when the backend cannot be reached (docs/protocol.md §21). */
export type ChainVia = 'backend' | 'whatsonchain';

export async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : fallback;
  } catch {
    return fallback;
  }
}

async function listUtxosThroughBackend(address: string, apiOptions: ApiFetchOptions): Promise<Utxo[]> {
  const utxosResponse = await apiFetch(`/utxos/${address}`, undefined, apiOptions);
  if (!utxosResponse.ok) {
    throw new Error(await readErrorMessage(utxosResponse, 'Could not fetch spendable coins.'));
  }
  return ((await utxosResponse.json()) as { utxos: Utxo[] }).utxos;
}

/**
 * The address's coins the backend lists, less those a pending send of ours already
 * spent, plus the change those sends produced even when the list omits it, without
 * duplicates. `now` stamps the pending-spend reconciliation. `via` says who lists the
 * coins: the backend by default, WhatsOnChain when the backend is out of reach.
 */
export async function loadSpendableUtxos(address: string, apiOptions: ApiFetchOptions, now = new Date(), via: ChainVia = 'backend'): Promise<Utxo[]> {
  const rawUtxos = via === 'whatsonchain' ? await fetchUtxosFromWhatsOnChain(address, apiOptions.fetchImpl) : await listUtxosThroughBackend(address, apiOptions);

  // WhatsOnChain keeps listing an outpoint as unspent for a while after a mempool
  // transaction of ours has already spent it (mw-1589l.28): exclude what we remember
  // spending, and spend the change it produced even when the list omits that too.
  const pendingEntries = await pendingSpendsRepo.getAll();
  // A chained pending entry's own spent outpoint is an earlier entry's change output,
  // which the backend may not list at all until the earlier send confirms: reconcile
  // would otherwise read that silence as "caught up, drop it" and forget the chained
  // entry after a single send, letting its input be spent again once the backend
  // finally lists it (mw-tfne4.33). Feed it every pending entry's change outpoint too,
  // so a chained entry stays until it truly expires or is confirmed spent-and-gone.
  const chainedChangeOutpoints = pendingEntries
    .map((entry) => entry.changeOutpoint)
    .filter((outpoint): outpoint is NonNullable<typeof outpoint> => outpoint != null);
  const { remaining, dropped } = reconcilePendingSpends(
    pendingEntries,
    [...rawUtxos, ...chainedChangeOutpoints],
    now,
  );
  if (dropped.length > 0) {
    await pendingSpendsRepo.removeMany(dropped);
  }
  // reconcilePendingSpends is typed against the library's PendingSpendEntry, which
  // narrows away our changeOutpoint field: look the surviving entries back up by
  // txid to keep it.
  const remainingTxids = new Set(remaining.map((entry) => entry.txid));
  const pendingSpends = pendingEntries.filter((entry) => remainingTxids.has(entry.txid));
  const { utxos: unspentUtxos } = filterUtxosExcludingPending(rawUtxos, pendingSpends);
  const excludedOutpoints = new Set(pendingSpends.flatMap((entry) => entry.outpoints));
  const candidateUtxos = [...unspentUtxos];
  for (const entry of pendingSpends) {
    const change = entry.changeOutpoint;
    if (!change || excludedOutpoints.has(outpointKey(change))) continue;
    candidateUtxos.push({ txid: change.txid, vout: change.vout, satoshis: change.satoshis });
  }
  // The backend can list the same outpoint twice, or list a pending entry's change
  // outpoint that the entry above already contributed — de-duplicate by one canonical
  // outpoint key once, rather than building the transaction with the same input twice
  // (mw-tfne4.33).
  const seenOutpoints = new Set<string>();
  const utxos: Utxo[] = [];
  for (const utxo of candidateUtxos) {
    const key = outpointKey(utxo);
    if (seenOutpoints.has(key)) continue;
    seenOutpoints.add(key);
    utxos.push(utxo);
  }
  return utxos;
}

/** POSTs the signed transaction to the backend's /api/broadcast; resolves with its txid. */
export async function broadcastThroughBackend(rawtx: string, apiOptions: ApiFetchOptions): Promise<string> {
  const broadcastResponse = await apiFetch(
    '/broadcast',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawtx }),
    },
    apiOptions,
  );
  if (!broadcastResponse.ok) {
    throw new Error(await readErrorMessage(broadcastResponse, 'The backend rejected the broadcast.'));
  }
  const broadcastBody = (await broadcastResponse.json()) as { txid?: unknown };
  if (typeof broadcastBody.txid !== 'string') {
    throw new Error('The broadcast succeeded but returned no transaction id.');
  }
  return broadcastBody.txid;
}
