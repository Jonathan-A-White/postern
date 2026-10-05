// src/cockpit/StampSection.tsx — the chain stamp a landing left on a bead (mw-zuju64.1; millwright
// docs/chain-stamps.md): for each 'STAMP <txid> for <commit> (testnet)' comment, the transaction, when its block was
// made, a link to it, and whether the record on chain checks out for this bead's rig and that commit. The chain is
// asked once for each stamp each time the bead page opens (through the limiter in services/stamp.ts).
import { useEffect, useMemo, useState } from 'react';
import { Icon, SectionTitle, Spinner, cx } from '../ui';
import type { BeadComment } from '../model/view';
import { explorerUrl, parseStampComments, verifyStamp, wocStampChain, type StampResult } from '../services/stamp';
import { useUnlockedKey } from './hooks';

function blockTimeText(result: StampResult | undefined): string {
  if (!result || result.blockTime === undefined) return '';
  return result.blockTime === null ? 'In the mempool, no block yet' : new Date(result.blockTime * 1000).toLocaleString();
}

function StampRow({ txid, commit, rig }: { txid: string; commit: string; rig: string }) {
  const key = useUnlockedKey();
  const [result, setResult] = useState<StampResult>();

  useEffect(() => {
    if (!rig) return;
    let cancelled = false;
    verifyStamp({ txid, rig, commit }, wocStampChain(), key).then((checked) => {
      if (!cancelled) setResult(checked);
    });
    return () => {
      cancelled = true;
    };
  }, [txid, rig, commit, key]);

  const time = blockTimeText(result);
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="font-mono text-[13px]" title={txid}>
          {txid.slice(0, 8)}…{txid.slice(-6)}
        </span>
        <a className="text-[13px] underline" href={explorerUrl(txid)} target="_blank" rel="noreferrer">
          View on chain
        </a>
      </div>
      {time && <span className="text-[12.5px] text-muted">{time}</span>}
      {!rig ? (
        <p className="text-[13px] text-muted">This bead has no rig, so there is nothing to check the stamp against.</p>
      ) : !result ? (
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <Spinner size={14} /> Checking the chain…
        </p>
      ) : result.status === 'checks-out' ? (
        <p className="flex items-center gap-2 text-[13px] font-medium text-done">
          <Icon name="check" size={16} />
          <span>Checks out</span>
        </p>
      ) : (
        <p className={cx('text-[13px]', result.status === 'locked' ? 'text-muted' : 'text-danger')}>{result.reason}</p>
      )}
    </div>
  );
}

export function StampSection({ rig, comments }: { rig: string; comments: readonly BeadComment[] }) {
  const stamps = useMemo(() => parseStampComments(comments), [comments]);
  if (stamps.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" aria-label="Stamp">
      <SectionTitle>Stamp</SectionTitle>
      {stamps.map((stamp) => (
        <StampRow key={stamp.txid} txid={stamp.txid} commit={stamp.commit} rig={rig} />
      ))}
    </section>
  );
}
