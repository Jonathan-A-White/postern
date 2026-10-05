// tests/unit/stamp.test.ts — mw-zuju64.1: reading a chain stamp (millwright docs/chain-stamps.md) back:
// the comment that names it, its commitment, and whether the record on chain checks out.
import { describe, expect, it } from 'vitest';
import { Utils } from '@bsv/sdk';
import { commitmentOf, parseStampComments, verifyStamp, type StampChain } from '../../src/services/stamp';
import { publicKeyOf, stampTransaction } from '../support/chain-record';

const GOVERNOR = '11'.repeat(32);
const SENDER = '22'.repeat(32);
const RIG = 'trade-tracker';
const COMMIT = '1fc03343fca689a0c83e2d5019463b332b401ab6';
const KEY = new Uint8Array(Utils.toArray(GOVERNOR, 'hex'));

function stampOnChain(over: { rig?: string; commit?: string; body?: { rig?: string; commit?: string } } = {}) {
  return stampTransaction({ senderHex: SENDER, recipientPublicKeyHex: publicKeyOf(GOVERNOR), rig: over.rig ?? RIG, commit: over.commit ?? COMMIT, body: over.body });
}

/** A WhatsOnChain that holds `hex` for `txid`, mined at `blockTime` (null: still in the mempool). */
function chainWith(txid: string, hex: string, blockTime: number | null = 1_790_000_100): StampChain & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    rawHex: async (id) => {
      calls.push(`hex ${id}`);
      if (id !== txid) throw Object.assign(new Error('not found'), { status: 404 });
      return hex;
    },
    blockTime: async (id) => {
      calls.push(`info ${id}`);
      return blockTime;
    },
  };
}

describe('commitmentOf', () => {
  it('is the lower-case hex SHA-256 of the rig, a newline and the commit', async () => {
    expect(await commitmentOf(RIG, COMMIT)).toBe('59d72f15571d4732510d7df51d23dd25bb8d8b5e15898be48704c09f31874ad8');
  });
});

describe('parseStampComments', () => {
  const TXID = 'ab'.repeat(32);

  it('finds the txid and the commit in the comment the chain-stamp job writes', () => {
    const comments = [
      { at: '2026-10-05T10:00:00Z', author: 'mw@laptop', text: 'Claimed.' },
      { at: '2026-10-05T10:01:00Z', author: 'mw@laptop', text: `STAMP ${TXID} for ${COMMIT} (testnet)` },
    ];
    expect(parseStampComments(comments)).toEqual([{ txid: TXID, commit: COMMIT }]);
  });

  it('finds each stamp once, in order, and none in a comment that only mentions the word', () => {
    const other = 'cd'.repeat(20);
    const comments = [
      { at: '', author: '', text: `STAMP ${TXID} for ${COMMIT} (testnet)` },
      { at: '', author: '', text: `STAMP ${TXID} for ${COMMIT} (testnet)` },
      { at: '', author: '', text: `STAMP ${'ef'.repeat(32)} for ${other} (testnet)` },
      { at: '', author: '', text: 'I will STAMP this later' },
    ];
    expect(parseStampComments(comments).map((s) => s.commit)).toEqual([COMMIT, other]);
  });
});

describe('verifyStamp', () => {
  it('checks out when the commitment matches and the sealed body names the same rig and commit', async () => {
    const tx = stampOnChain();
    const chain = chainWith(tx.txid, tx.hex);
    const result = await verifyStamp({ txid: tx.txid, rig: RIG, commit: COMMIT }, chain, KEY);
    expect(result).toMatchObject({ status: 'checks-out', blockTime: 1_790_000_100 });
  });

  it('keeps a null block time for a transaction still in the mempool', async () => {
    const tx = stampOnChain();
    const result = await verifyStamp({ txid: tx.txid, rig: RIG, commit: COMMIT }, chainWith(tx.txid, tx.hex, null), KEY);
    expect(result).toMatchObject({ status: 'checks-out', blockTime: null });
  });

  it('is a mismatch when one character of the commit differs', async () => {
    const tx = stampOnChain();
    const result = await verifyStamp({ txid: tx.txid, rig: RIG, commit: COMMIT.slice(0, -1) + '7' }, chainWith(tx.txid, tx.hex), KEY);
    expect(result.status).toBe('mismatch');
    expect(result.reason).toBe('The commitment on chain does not match this commit');
  });

  it('is a mismatch when the sealed body was made for another rig', async () => {
    const tx = stampOnChain({ body: { rig: 'other-rig' } });
    const result = await verifyStamp({ txid: tx.txid, rig: RIG, commit: COMMIT }, chainWith(tx.txid, tx.hex), KEY);
    expect(result.status).toBe('mismatch');
    expect(result.reason).toMatch(/sealed part/);
  });

  it('is a mismatch when the transaction carries no stamp record', async () => {
    const result = await verifyStamp({ txid: 'aa'.repeat(32), rig: RIG, commit: COMMIT }, chainWith('aa'.repeat(32), '00'), KEY);
    expect(result.status).toBe('mismatch');
    expect(result.reason).toBe('That transaction is not a chain stamp');
  });

  it('is unreachable when WhatsOnChain cannot be fetched from', async () => {
    const chain: StampChain = {
      rawHex: async () => {
        throw new TypeError('Failed to fetch');
      },
      blockTime: async () => null,
    };
    const result = await verifyStamp({ txid: 'aa'.repeat(32), rig: RIG, commit: COMMIT }, chain, KEY);
    expect(result).toMatchObject({ status: 'unreachable', reason: 'Could not reach WhatsOnChain' });
  });

  it('is not found when WhatsOnChain does not know the transaction', async () => {
    const tx = stampOnChain();
    const result = await verifyStamp({ txid: 'bb'.repeat(32), rig: RIG, commit: COMMIT }, chainWith(tx.txid, tx.hex), KEY);
    expect(result.status).toBe('not-found');
  });

  it('is locked with no key, and says what it did check', async () => {
    const tx = stampOnChain();
    const result = await verifyStamp({ txid: tx.txid, rig: RIG, commit: COMMIT }, chainWith(tx.txid, tx.hex), null);
    expect(result.status).toBe('locked');
    expect(result.reason).toBe('Unlock your key to open the sealed part. The commitment on chain matches this commit.');
  });

  it('is a mismatch, not locked, when the commitment already disagrees and there is no key', async () => {
    const tx = stampOnChain();
    const result = await verifyStamp({ txid: tx.txid, rig: RIG, commit: COMMIT.slice(0, -1) + '7' }, chainWith(tx.txid, tx.hex), null);
    expect(result.status).toBe('mismatch');
  });

  it('still answers when only the block time is out of reach', async () => {
    const tx = stampOnChain();
    const chain = chainWith(tx.txid, tx.hex);
    chain.blockTime = async () => {
      throw new TypeError('Failed to fetch');
    };
    const result = await verifyStamp({ txid: tx.txid, rig: RIG, commit: COMMIT }, chain, KEY);
    expect(result.status).toBe('checks-out');
    expect(result.blockTime).toBeUndefined();
  });
});
