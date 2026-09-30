// src/cockpit/HandsSteps.tsx — the steps only his hands could take, and now his
// thumb can (docs/protocol.md §17): each shown exactly as it will run — where, as
// whom, the commands and the way back — with "Approve and run" asking for his
// fingerprint again before his key signs it, or "I did it myself" to tell the
// Mayor. What ran says so, with its exit code. A step whose bead waits on an open
// bead offers neither: it says what it waits on, each a link to that bead.
import { useState } from 'react';
import { Button, Chip, Icon, TimeAgo, cx } from '../ui';
import type { HandsStep } from '../model/hands';
import type { WaitsOn } from '../model/needs';
import { approveHandsStep, sendToThread, useSend } from './send';

function StepCard({ bead, step, waitsOn }: { bead: string; step: HandsStep; waitsOn?: WaitsOn[] }) {
  const { busy, run } = useSend();
  const [confirming, setConfirming] = useState(false);
  const [approvedAt, setApprovedAt] = useState<number>();
  const [showWayBack, setShowWayBack] = useState(false);
  const root = step.as === 'root';
  const ranOk = step.ran && step.ran.exit === 0;
  const where = `${root ? 'as root' : 'as you'} on ${step.host}`;

  async function approve() {
    const sent = await run(() => approveHandsStep(bead, step), `Approved — ${step.id} runs ${where}`);
    setConfirming(false);
    if (sent) setApprovedAt(Date.now());
  }

  return (
    <li className={cx('flex flex-col gap-2.5 rounded-xl border bg-sunken p-3', root ? 'border-danger/30' : 'border-line')} data-testid="hands-step" aria-label={`Step ${step.id}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[13px] font-semibold">{step.id}</span>
        <Chip icon="host">{step.host}</Chip>
        <Chip tone={root ? 'danger' : 'neutral'}>{root ? 'as root' : 'as you'}</Chip>
        {step.ran &&
          (ranOk ? (
            <Chip tone="done" icon="check">
              ran <TimeAgo at={step.ran.at} />
            </Chip>
          ) : (
            <Chip tone="blocked" icon="alarm">
              failed, exit {step.ran.exit}
            </Chip>
          ))}
        {!step.ran && approvedAt && (
          <Chip tone="working" icon="clock">
            approved, running…
          </Chip>
        )}
      </div>
      {step.ran && !ranOk && step.ran.why && (
        <div className="flex flex-col gap-0.5" role="alert">
          <span className="text-[14px] font-semibold text-danger">Failed</span>
          <span className="text-[13px] whitespace-pre-wrap break-words">{step.ran.why}</span>
        </div>
      )}
      <pre className="overflow-x-auto rounded-lg bg-canvas p-2.5 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-all">{step.run}</pre>
      {step.way_back && (
        <div>
          <button type="button" onClick={() => setShowWayBack((v) => !v)} aria-expanded={showWayBack} className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
            <Icon name="down" size={14} className={cx('transition-transform', showWayBack && 'rotate-180')} />
            Way back
          </button>
          {showWayBack && <pre className="mt-1.5 overflow-x-auto rounded-lg bg-canvas p-2.5 font-mono text-[12px] whitespace-pre-wrap break-all text-muted">{step.way_back}</pre>}
        </div>
      )}
      {!ranOk && !approvedAt && waitsOn && (
        <p className="text-[13px] text-muted">
          Waits on:{' '}
          {waitsOn.map((item, i) => (
            <span key={`${i}:${item.title}`}>
              {i > 0 && ', '}
              {item.href ? (
                <a href={item.href} className="text-fg hover:underline">
                  {item.title}
                </a>
              ) : (
                item.title
              )}
            </span>
          ))}
        </p>
      )}
      {!ranOk && !approvedAt && !waitsOn && (
        confirming ? (
          <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-2.5" role="group" aria-label="Confirm">
            <p className="text-[13px]">
              Run <span className="font-mono font-semibold">{step.id}</span> {where}? It runs exactly the text above.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={root ? 'danger' : 'primary'} icon="fingerprint" busy={busy} onClick={() => void approve()}>
                Confirm and run
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" icon="play" onClick={() => setConfirming(true)}>
              {step.ran ? 'Approve and run again' : 'Approve and run'}
            </Button>
            <Button size="sm" variant="ghost" icon="hand" disabled={busy} onClick={() => void run(() => sendToThread({ bead }, `I ran step ${step.id} myself.`), 'Told the Mayor')}>
              I did it myself
            </Button>
          </div>
        )
      )}
    </li>
  );
}

/** `waitsOn` set (even empty) means the bead cannot be acted on yet: the steps show, nothing to tap. */
export function HandsSteps({ bead, steps, waitsOn }: { bead: string; steps: HandsStep[]; waitsOn?: WaitsOn[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="flex flex-col gap-2" aria-label="Steps for your hands">
      {steps.map((step) => (
        <StepCard key={`${step.id}:${step.sha256}`} bead={bead} step={step} waitsOn={waitsOn} />
      ))}
    </ol>
  );
}
