// src/services/sharedChainReads.ts — the ChainProvider the Key screen reads the chain through:
// the balance line, the licence check (licence.ts) and the Issued licences list (issue.ts).
// They ask for overlapping things, and used to ask each on its own: the same address history
// twice, and every transaction's hex twice, ran in parallel. Through here
//   - every request waits its turn in one queue (chainPacer.ts), history pages included;
//   - a transaction's hex is read once for the page's life, since a txid never names different
//     bytes (kept in memory only: nothing stored, no schema), and a read that fails is dropped
//     so the next try asks again for that one alone;
//   - an address list asked while the same one is on its way is answered by that request.
// The count a Key screen open makes is in docs/key-screen-reads.md.
import { createChainProvider, type AddressHistoryEntry, type ChainProvider } from 'spell-forge-bsv';
import { paced } from './chainPacer';
import { readConfirmedHistory } from './confirmedHistory';

const hexByTxid = new Map<string, Promise<string>>();
const listsOnTheWay = new Map<string, Promise<AddressHistoryEntry[]>>();

/** Forgets every cached transaction and list on the way; a test starts clean, a phone never needs it. */
export function resetSharedChainReads(): void {
  hexByTxid.clear();
  listsOnTheWay.clear();
}

/** One fetch of a list at a time per name: callers that arrive while it is on its way share it. */
function shareWhileOnTheWay(name: string, read: () => Promise<AddressHistoryEntry[]>): Promise<AddressHistoryEntry[]> {
  const onTheWay = listsOnTheWay.get(name);
  if (onTheWay) return onTheWay;
  const started = read().finally(() => listsOnTheWay.delete(name));
  listsOnTheWay.set(name, started);
  return started;
}

export function sharedChainReads(): ChainProvider {
  // The library builds a provider per call; its own spacing only ever delays a second request
  // of one instance, and the queue above has already spaced this one.
  const provider = () => createChainProvider();
  return {
    getUtxos: (address) => paced(() => provider().getUtxos(address)),
    broadcast: (hex) => paced(() => provider().broadcast(hex)),
    getTransactionHex: (txid) => {
      const key = txid.trim();
      const known = hexByTxid.get(key);
      if (known) return known;
      const started = paced(() => provider().getTransactionHex(key));
      hexByTxid.set(key, started);
      started.catch(() => {
        if (hexByTxid.get(key) === started) hexByTxid.delete(key);
      });
      return started;
    },
    getAddressHistory: (address) =>
      shareWhileOnTheWay(`confirmed:${address.trim()}`, () => readConfirmedHistory(address.trim())),
    getUnconfirmedAddressHistory: (address) =>
      shareWhileOnTheWay(`unconfirmed:${address.trim()}`, () => {
        return paced(async () => (await provider().getUnconfirmedAddressHistory?.(address)) ?? []);
      }),
  };
}
