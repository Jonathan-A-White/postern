// tests/support/chain-record.ts — a raw transaction carrying one postern record for the anchor
// address, and a faked WhatsOnChain that lists such transactions as the anchor address's history
// (docs/protocol.md §3, §21): what the phone reads when it reads the chain itself.
import { createHash } from 'node:crypto';
import { P2PKH, PrivateKey, Script, Transaction, Utils } from '@bsv/sdk';
import { chainConfig, encodeRecordScript } from 'spell-forge-bsv';
import { ANCHOR_ADDRESS, encryptMessage, type MessageClass } from '../../src/services/messages';

export interface ChainRecord {
  hex: string;
  txid: string;
}

/** The funded-looking transaction a sender would broadcast: output 0 the record, output 1 the 1-sat anchor payment. */
export function recordTransaction(params: { senderHex: string; recipientPublicKeyHex: string; class: MessageClass; plaintext: string; ts: number }): ChainRecord {
  const payload = encryptMessage({ text: params.plaintext, class: params.class, senderPrivateKeyHex: params.senderHex, recipientPublicKeyHex: params.recipientPublicKeyHex, ts: params.ts });
  return transactionOfPayload(payload);
}

/** The same transaction for a payload already made: the chain copy of a record that was also delivered direct. */
export function transactionOfPayload(payload: object): ChainRecord {
  const tx = new Transaction();
  tx.addInput({ sourceTXID: 'aa'.repeat(32), sourceOutputIndex: 0, unlockingScript: new Script(), sequence: 0xffffffff });
  tx.addOutput({ satoshis: 0, lockingScript: encodeRecordScript(Utils.toArray(JSON.stringify(payload), 'utf8')) });
  tx.addOutput({ satoshis: 1, lockingScript: new P2PKH().lock(ANCHOR_ADDRESS) });
  return { hex: tx.toHex(), txid: tx.id('hex') };
}

export interface StampBody {
  rig: string;
  branch?: string;
  commit: string;
  story?: string;
  title?: string;
  host?: string;
  at?: string;
}

/** The stamp record millwright's chain-stamp job broadcasts (millwright docs/chain-stamps.md): its commitment in the
 * clear, its body (a JSON of rig, commit…) sealed to the Governor. The commitment is made from `rig` and `commit`;
 * `body` overrides what is sealed, so a test can make the two differ. */
export function stampTransaction(params: { senderHex: string; recipientPublicKeyHex: string; rig: string; commit: string; body?: Partial<StampBody>; ts?: number }): ChainRecord {
  const body: StampBody = { branch: 'main', story: 'mw-test.1', title: 'A story', host: 'laptop', at: '2026-10-05T10:00:00Z', rig: params.rig, commit: params.commit, ...params.body };
  const sealed = encryptMessage({ text: JSON.stringify(body), class: 'message', senderPrivateKeyHex: params.senderHex, recipientPublicKeyHex: params.recipientPublicKeyHex });
  const payload = {
    v: 1,
    kind: 'stamp',
    to: sealed.to,
    from: sealed.from,
    ts: params.ts ?? 1_790_000_000,
    commitment: createHash('sha256').update(`${params.rig}\n${params.commit}`).digest('hex'),
    ct: sealed.ct,
  };
  return transactionOfPayload(payload);
}

export function publicKeyOf(privateHex: string): string {
  return PrivateKey.fromHex(privateHex).toPublicKey().toString();
}

export interface FakeAnchorChain {
  fetchImpl: typeof fetch;
  /** Every URL asked of WhatsOnChain, in order. */
  calls: string[];
  /** The transactions the address history lists, newest last. */
  txs: ChainRecord[];
  /** Makes every answer a failure (WhatsOnChain unreachable too). */
  down: boolean;
  /** The raw transactions (by txid) whose hex WhatsOnChain fails to give (a 500). */
  failHex: Set<string>;
  /** When set, every raw-hex answer is this status (429: the free tier's limit). */
  hexStatus?: number;
  /** When set, the history answers are this status. */
  historyStatus?: number;
}

function reply(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) } as unknown as Response;
}

/** A WhatsOnChain that lists `txs` as the anchor address's confirmed history and serves their raw hex. */
export function fakeAnchorChain(txs: ChainRecord[] = []): FakeAnchorChain {
  const fake: FakeAnchorChain = { calls: [], txs, down: false, failHex: new Set(), fetchImpl: undefined as unknown as typeof fetch };
  fake.fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fake.calls.push(url);
    if (fake.down) throw new TypeError('Failed to fetch');
    const base = `${chainConfig.providerBaseUrl}/address/${ANCHOR_ADDRESS}`;
    if (fake.historyStatus && url.startsWith(base)) return reply(fake.historyStatus, 'busy');
    if (url === `${base}/unconfirmed/history`) return reply(200, { result: [] });
    if (url === `${base}/confirmed/history`) return reply(200, { result: fake.txs.map((tx, i) => ({ tx_hash: tx.txid, height: 100 + i })) });
    const raw = /\/tx\/([0-9a-f]{64})\/hex$/.exec(url);
    if (raw && fake.hexStatus) return reply(fake.hexStatus, 'busy');
    if (raw && fake.failHex.has(raw[1])) return reply(500, 'boom');
    const found = raw && fake.txs.find((tx) => tx.txid === raw[1]);
    if (found) return reply(200, found.hex);
    return reply(404, 'not found');
  }) as typeof fetch;
  return fake;
}
