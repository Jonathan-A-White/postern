// src/services/deliver.ts — sends anything the Governor says or taps (plans/0021
// decisions 5, 7 and 10): the §1 envelope, encrypted to the pinned Mayor, posted
// straight to the backend (docs/protocol.md §9) — one round trip, no coins. An
// old backend that has no direct delivery gets today's funded transaction
// instead; a Call me whose backend cannot be reached gets that transaction too,
// sent through WhatsOnChain (§21). Either way the sent message is stored at
// once, so it shows in its thread before the event stream echoes it back.
import { PrivateKey, Utils } from '@bsv/sdk';
import { encodeRecordScript } from 'spell-forge-bsv';
import { apiFetch, ApiTimeoutError, BackendUnreachableError, withTimeout } from './apiAuth';
import { encryptMessage, type MessageClass } from './messages';
import { readErrorMessage, sendTextMessage } from './send';
import type { ChainVia } from './spendable';
import { encodeReply } from './questions';
import { encodeThreadedMessage, threadKey, threadOf, type Attachment, type ThreadRef } from './threads';
import { messagesRepo } from '../data/repositories';
import type { GovernorAction } from '../model/conversation';
import type { HomeHost } from './standby';

export interface DeliverOptions {
  key: Uint8Array;
  mayorKey: string;
  /** Whether the backend takes direct delivery (docs/protocol.md §15). */
  direct: boolean;
  /** The phone knows the backend is out of reach (the live status is offline): a Call me skips the direct post and goes on chain (docs/protocol.md §21). */
  offline?: boolean;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

export interface Delivered {
  txid: string;
  channel: 'direct' | 'chain';
}

class DirectUnsupported extends Error {}

/** A call that never reached a working backend: no connection, no answer in time, or a gateway error. */
function isNetworkFailure(err: unknown): boolean {
  return err instanceof TypeError || err instanceof ApiTimeoutError || err instanceof BackendUnreachableError;
}

async function postDirect(scriptHex: string, options: DeliverOptions): Promise<string> {
  const response = await apiFetch(
    '/messages',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scriptHex }) },
    { unlockedKey: options.key, apiBase: options.apiBase, fetchImpl: options.fetchImpl },
  );
  if (response.status === 404 || response.status === 405) throw new DirectUnsupported();
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    throw new BackendUnreachableError(await readErrorMessage(response, 'The backend refused the message.'));
  }
  if (!response.ok) throw new Error(await readErrorMessage(response, 'The backend refused the message.'));
  const body = (await withTimeout(response.json(), true)) as { txid?: unknown };
  if (typeof body.txid !== 'string') throw new Error('The backend took the message but named no id.');
  return body.txid;
}

/** Runs a local-cache write without holding the caller: a rejection is logged, a hang is ignored. */
export function writeBehind(write: Promise<unknown>, what: string): void {
  const tracked = write.catch((err: unknown) => console.warn(`Could not keep ${what} on this phone:`, err));
  writing.add(tracked);
  void tracked.finally(() => writing.delete(tracked));
}

const writing = new Set<Promise<unknown>>();

/** Resolves once every write-behind started so far has finished (a test's seam;
 * the app never waits on it, and a write that hangs keeps it waiting). */
export async function settledWrites(): Promise<void> {
  await Promise.all([...writing]);
}

async function rememberSent(
  txid: string,
  plaintext: string,
  messageClass: MessageClass,
  payload: ReturnType<typeof encryptMessage>,
  senderPrivateKeyHex: string,
): Promise<void> {
  const existing = await messagesRepo.get(`${txid}:0`);
  await messagesRepo.put({
    id: `${txid}:0`,
    txid,
    vout: 0,
    seq: existing?.seq ?? Number.MAX_SAFE_INTEGER,
    class: messageClass,
    to: payload.to,
    from: PrivateKey.fromHex(senderPrivateKeyHex).toPublicKey().toString(),
    ts: payload.ts,
    ciphertext: payload.ct,
    plaintext,
    direction: 'sent',
    read: true,
    thread: threadKey(threadOf(messageClass, plaintext)),
  });
}

/** Encrypts `plaintext` to the Mayor and delivers it; resolves with its id. */
export async function deliver(plaintext: string, messageClass: MessageClass, options: DeliverOptions): Promise<Delivered> {
  if (!options.mayorKey) throw new Error("The Mayor's key is not known yet — connect to the backend once first.");
  const senderPrivateKeyHex = Utils.toHex(Array.from(options.key));
  const payload = encryptMessage({ text: plaintext, class: messageClass, senderPrivateKeyHex, recipientPublicKeyHex: options.mayorKey });

  // Only a Call me (docs/protocol.md §21) goes on chain when the backend cannot be reached:
  // a network failure leaves the rule for every other class as it was.
  const callsOnChainWhenDown = messageClass === 'call';
  let via: ChainVia = 'backend';
  let delivered: Delivered | undefined;
  if (options.direct && !(callsOnChainWhenDown && options.offline)) {
    try {
      const script = encodeRecordScript(Utils.toArray(JSON.stringify(payload), 'utf8'));
      delivered = { txid: await postDirect(script.toHex(), options), channel: 'direct' };
    } catch (err) {
      if (callsOnChainWhenDown && isNetworkFailure(err)) via = 'whatsonchain';
      else if (!(err instanceof DirectUnsupported)) throw err;
    }
  } else if (callsOnChainWhenDown && options.offline) {
    via = 'whatsonchain';
  }
  if (!delivered) {
    const txid = await sendTextMessage({
      text: plaintext,
      class: messageClass,
      senderKey: options.key,
      recipientPublicKeyHex: options.mayorKey,
      apiBase: options.apiBase,
      fetchImpl: options.fetchImpl,
      via,
    });
    delivered = { txid, channel: 'chain' };
  }

  // The server has answered: the message has gone. Keeping a local copy is not
  // part of sending, so a write that fails or hangs is logged and never awaited.
  writeBehind(rememberSent(delivered.txid, plaintext, messageClass, payload, senderPrivateKeyHex), 'the sent message');
  return delivered;
}

export interface ThreadedMessage {
  thread?: ThreadRef;
  text: string;
  attachment?: Attachment;
  attachments?: Attachment[];
  re?: string;
}

export function deliverThreaded(message: ThreadedMessage, options: DeliverOptions): Promise<Delivered> {
  return deliver(encodeThreadedMessage(message), 'message', options);
}

/** docs/protocol.md §6: his answer to a question on `bead`. */
export function deliverAnswer(bead: string, answer: string, options: DeliverOptions): Promise<Delivered> {
  return deliver(encodeReply({ bead, answer }), 'message', options);
}

/** docs/protocol.md §13: a one-tap action the Mayor's host applies at once. */
export function deliverAction(action: GovernorAction, options: DeliverOptions): Promise<Delivered> {
  return deliver(JSON.stringify(action), 'message', options);
}

/** Q2 of the factory's home (mw-43v9x.9): asks the Mayor to move the home to `host`.
 * The class rides in the clear, so the Mayor's host can act on it without reading. */
export function deliverMoveHome(host: HomeHost, options: DeliverOptions): Promise<Delivered> {
  return deliver(JSON.stringify({ host }), 'move-home', options);
}
