// src/chain.ts — the one door the services reach the chain through (mw-e6e8f2.2). deliver and
// live send and read through `chain`, never through a chain module of their own; a lint rule
// (eslint.config.js) refuses the direct import. `chain` is BSV today, built from the same
// modules, unchanged; `setChain` plugs another implementation in (a test's, or a later one).
import { CHAIN_POLL_MS, nextChainDelay, readChain, type ChainRead, type ReadChainParams } from './services/chainRead';
import { sendTextMessage, type SendMessageParams } from './services/send';
import type { ChainVia } from './services/spendable';

export type { ChainRead, ChainVia, ReadChainParams, SendMessageParams };

/** What the services need from a chain. */
export interface Chain {
  /** Encrypts, signs and sends one text record; resolves with its id, or throws a readable error and sends nothing. */
  sendText(params: SendMessageParams): Promise<string>;
  /** Reads the records new to this phone since the transactions already `seen`; throws when the chain cannot be reached. */
  read(params: ReadChainParams): Promise<ChainRead>;
  /** How long the chain poll waits before its first read, in ms. */
  pollMs: number;
  /** The wait before the next read, given the last wait and how the read went. */
  nextDelay(current: number, clean: boolean, found: boolean): number;
}

/** BSV: the modules as they were, called through at the moment of use. */
const bsv: Chain = {
  sendText: (params) => sendTextMessage(params),
  read: (params) => readChain(params),
  // a getter: chainRead is still loading when this module is, through live's own imports
  get pollMs() {
    return CHAIN_POLL_MS;
  },
  nextDelay: (current, clean, found) => nextChainDelay(current, clean, found),
};

/** The implementation in use. */
export let chain: Chain = bsv;

/** Plugs `next` in as the implementation in use; returns the one it replaces. */
export function setChain(next: Chain): Chain {
  const previous = chain;
  chain = next;
  return previous;
}
