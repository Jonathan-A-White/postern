// src/services/whatsonchain.ts — the phone talking to WhatsOnChain itself, for the one time
// the backend cannot be reached and a Call me still has to leave (docs/protocol.md §21): the
// address's unspent coins and a raw transaction's broadcast, at the chain provider the rig's
// chain switch names (spell-forge-bsv's chainConfig). The backend's poller reads the anchor
// address from the same chain, so a record broadcast here reaches the Mayor all the same.
import { chainConfig, type Utxo } from 'spell-forge-bsv';

const TXID = /^[0-9a-f]{64}$/;

async function readText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return '';
  }
}

/** The address's unspent coins as WhatsOnChain lists them (`/address/<addr>/unspent`). An address it has never seen has none. */
export async function fetchUtxosFromWhatsOnChain(address: string, fetchImpl: typeof fetch = fetch): Promise<Utxo[]> {
  const response = await fetchImpl(`${chainConfig.providerBaseUrl}/address/${address}/unspent`);
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`WhatsOnChain could not list the spendable coins (it answered ${response.status}).`);
  const list = (await response.json().catch(() => undefined)) as unknown;
  if (!Array.isArray(list)) throw new Error('WhatsOnChain answered the spendable coins with something that is not a list.');
  return list.map((entry: { tx_hash: string; tx_pos: number; value: number; height?: number }) => ({
    txid: entry.tx_hash,
    vout: entry.tx_pos,
    satoshis: entry.value,
    height: entry.height,
  }));
}

/** POSTs the signed transaction to WhatsOnChain's `/tx/raw` as `{txhex}`; resolves with its txid. */
export async function broadcastThroughWhatsOnChain(rawtx: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl(`${chainConfig.providerBaseUrl}/tx/raw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txhex: rawtx }),
  });
  const text = await readText(response);
  if (!response.ok) throw new Error(`WhatsOnChain refused the broadcast: ${text || response.status}`);
  const txid = text.replace(/^"|"$/g, '');
  if (!TXID.test(txid)) throw new Error('The broadcast succeeded but returned no transaction id.');
  return txid;
}
