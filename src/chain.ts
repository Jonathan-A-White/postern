// src/chain.ts — the one door the services reach the chain through (mw-e6e8f2.2). deliver and
// live send and read through `chain`, never through a chain module of their own; a lint rule
// (eslint.config.js) refuses the direct import. `chain` is BSV today, built from the same
// modules, unchanged; `setChain` plugs another implementation in (a test's, or a later one).
// The Key screen and the bead page reach the chain here too (mw-e6e8f2.3): the data calls below,
// and the chain-only components as `screens`, which an implementation without a chain leaves out
// and the screen then shows nothing there.
import type { ComponentType } from 'react';
import type { BeadComment } from './model/view';
import { CHAIN_POLL_MS, nextChainDelay, readChain, type ChainRead, type ReadChainParams } from './services/chainRead';
import {
  fetchIssuerBalance,
  issueCost,
  issueLicence,
  issuedLicences,
  revokeLicence,
  type IssueContext,
  type IssueCost,
  type IssueLicenceParams,
  type IssuedLicence,
  type IssuedLicenceEntry,
  type RevokeLicenceParams,
} from './services/issue';
import { addressForPublicKey, checkLicence, getCachedLicenceStatus, type LicenceStatus } from './services/licence';
import { fetchBalanceSatoshis, mintCostSatoshis, mintMyLicence, type MintResult } from './services/mint';
import { sendTextMessage, type SendMessageParams } from './services/send';
import type { ChainVia } from './services/spendable';
import { explorerUrl, verifyStamp, wocStampChain, type StampResult } from './services/stamp';
import { IssueLicences } from './key/IssueLicences';
import { LicenceExplainer } from './licence/LicenceExplainer';
import { StampSection } from './cockpit/StampSection';

export type {
  ChainRead,
  ChainVia,
  IssueContext,
  IssueCost,
  IssueLicenceParams,
  IssuedLicence,
  IssuedLicenceEntry,
  LicenceStatus,
  MintResult,
  ReadChainParams,
  RevokeLicenceParams,
  SendMessageParams,
  StampResult,
};

/** What the Stamp section shows: the bead's rig and its comments, from which the STAMP ones are read. */
export interface StampSectionProps {
  rig: string;
  comments: readonly BeadComment[];
}

/** What the Issue licences block needs: the issuer's own key. */
export interface IssueLicencesProps {
  issuerKey: Uint8Array;
}

/** The screens that only make sense with a chain. A chain without one leaves it out and the screen shows nothing there. */
export interface ChainScreens {
  StampSection?: ComponentType<StampSectionProps>;
  LicenceExplainer?: ComponentType;
  IssueLicences?: ComponentType<IssueLicencesProps>;
}

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
  /** The address a licence locked to this public key shows, and is funded at. */
  addressFor(publicKeyHex: string): string;
  /** Looks for this key's licence on the chain; throws when the chain cannot be reached. */
  checkLicence(publicKeyHex: string): Promise<LicenceStatus>;
  /** The licence status the last check left, or undefined when none has been made. */
  cachedLicenceStatus(): Promise<LicenceStatus | undefined>;
  /** This key's balance in satoshis; throws when the chain cannot be reached. */
  balance(publicKeyHex: string): Promise<number>;
  /** What a balance must reach before a licence can be minted, in satoshis. */
  mintCost(): number;
  /** Mints this key's own licence; throws a readable error and sends nothing when it cannot. */
  mint(key: Uint8Array): Promise<MintResult>;
  /** What issuing a licence to someone else costs. */
  issueCost(): IssueCost;
  /** The issuer's spendable balance in satoshis. */
  issuerBalance(context: IssueContext): Promise<number>;
  /** Mints a licence to a holder's key, funded by the issuer. */
  issueLicence(params: IssueLicenceParams): Promise<IssuedLicence>;
  /** Ends a licence this key issued. */
  revokeLicence(params: RevokeLicenceParams): Promise<{ txid: string }>;
  /** The licences this key issued, with whether each is revoked. */
  issuedLicences(params: Parameters<typeof issuedLicences>[0]): Promise<IssuedLicenceEntry[]>;
  /** Whether the stamp `txid` checks out for this rig and commit; never throws. */
  verifyStamp(stamp: { txid: string; rig: string; commit: string }, key: Uint8Array | null): Promise<StampResult>;
  /** A link to a transaction on a block explorer. */
  explorerUrl(txid: string): string;
  /** The chain-only components. */
  screens: ChainScreens;
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
  addressFor: (publicKeyHex) => addressForPublicKey(publicKeyHex),
  checkLicence: (publicKeyHex) => checkLicence(publicKeyHex),
  cachedLicenceStatus: () => getCachedLicenceStatus(),
  balance: (publicKeyHex) => fetchBalanceSatoshis(publicKeyHex),
  mintCost: () => mintCostSatoshis(),
  mint: (key) => mintMyLicence(key),
  issueCost: () => issueCost(),
  issuerBalance: (context) => fetchIssuerBalance(context),
  issueLicence: (params) => issueLicence(params),
  revokeLicence: (params) => revokeLicence(params),
  issuedLicences: (params) => issuedLicences(params),
  verifyStamp: (stamp, key) => verifyStamp(stamp, wocStampChain(), key),
  explorerUrl: (txid) => explorerUrl(txid),
  // a getter: the components import this module, so they are still loading when it is
  get screens() {
    return { StampSection, LicenceExplainer, IssueLicences };
  },
};

/** The implementation in use. */
export let chain: Chain = bsv;

/** Plugs `next` in as the implementation in use; returns the one it replaces. */
export function setChain(next: Chain): Chain {
  const previous = chain;
  chain = next;
  return previous;
}
