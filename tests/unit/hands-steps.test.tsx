// mw-t64a3.10: a hands step that ran and failed says Failed, and why when the
// Mayor's host said why; a step that ran fine is unchanged.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { HandsSteps } from '../../src/cockpit/HandsSteps';
import type { HandsStep } from '../../src/model/hands';

afterEach(cleanup);

function step(ran?: HandsStep['ran']): HandsStep {
  return { id: 'linger', host: 'desktop', as: 'root', run: 'loginctl enable-linger jwhite', way_back: '', sha256: 'h', ...(ran ? { ran } : {}) };
}

function renderStep(ran?: HandsStep['ran']) {
  render(<HandsSteps bead="mw-abc.1" steps={[step(ran)]} />);
  return screen.getByRole('listitem', { name: 'Step linger' });
}

describe('HandsSteps outcome', () => {
  it('shows Failed and the why for a step that exited non-zero with a why', () => {
    const card = renderStep({ at: '2026-09-29T18:52:00Z', exit: 1, host: 'desktop', why: 'could not start: no such host "desktop"' });
    expect(within(card).getByText('Failed')).toBeInTheDocument();
    expect(within(card).getByText('could not start: no such host "desktop"')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Approve and run again' })).toBeInTheDocument();
  });

  it('reads as today for a failed step with no why', () => {
    const card = renderStep({ at: '2026-09-29T18:52:00Z', exit: 2, host: 'desktop' });
    expect(within(card).getByText('failed, exit 2')).toBeInTheDocument();
    expect(within(card).queryByText('Failed')).toBeNull();
    expect(within(card).getByRole('button', { name: 'Approve and run again' })).toBeInTheDocument();
  });

  it('leaves a step that exited 0 unchanged, even if a why is present', () => {
    const card = renderStep({ at: '2026-09-29T18:52:00Z', exit: 0, host: 'desktop', why: 'ignored' });
    expect(card).toHaveTextContent('ran');
    expect(within(card).queryByText('Failed')).toBeNull();
    expect(within(card).queryByText('ignored')).toBeNull();
    expect(within(card).queryByRole('button', { name: /Approve and run/ })).toBeNull();
  });
});
