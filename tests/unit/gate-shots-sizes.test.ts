// @vitest-environment node
//
// mw-pb8otc: the gate's gate:shots runs the shots project at 390x844 only; the e2e specs the
// branch changed are run again at the other two sizes (scripts/gate-shots-sizes.mjs), so a spec
// that holds at one layout only fails the gate, not the landing after it.
import { describe, it, expect } from 'vitest';
import { changedSpecs, extraSizes, planExtraRuns, noExtraRunLine } from '../../scripts/gate-shots-sizes.mjs';

describe('changedSpecs', () => {
  it('keeps only tests/e2e/*.spec.ts, sorted and once each', () => {
    const files = ['src/App.tsx', 'tests/e2e/talk-line.spec.ts', 'tests/e2e/bottom-bar.spec.ts', 'tests/e2e/shot.ts', 'tests/unit/a.test.ts', 'tests/e2e/talk-line.spec.ts'];
    expect(changedSpecs(files)).toEqual(['tests/e2e/bottom-bar.spec.ts', 'tests/e2e/talk-line.spec.ts']);
  });

  it('is empty when the branch changed no e2e spec', () => {
    expect(changedSpecs(['src/App.tsx', 'tests/e2e/shot.ts', 'tests/e2e/nested/x.spec.ts.bak'])).toEqual([]);
  });

  it('drops a spec the branch deleted', () => {
    expect(changedSpecs(['tests/e2e/gone.spec.ts'], () => false)).toEqual([]);
  });
});

describe('extraSizes', () => {
  it('are the two sizes after the gate\'s own 390x844', () => {
    expect(extraSizes().map((s: { name: string }) => s.name)).toEqual(['360x640', '1280x800']);
  });
});

describe('planExtraRuns', () => {
  it('runs each changed spec at both other sizes', () => {
    const plan = planExtraRuns(['tests/e2e/bottom-bar.spec.ts']);
    expect(plan.map((r: { size: string }) => r.size)).toEqual(['360x640', '1280x800']);
    for (const run of plan) expect(run.specs).toEqual(['tests/e2e/bottom-bar.spec.ts']);
  });

  it('plans nothing when no spec changed', () => {
    expect(planExtraRuns([])).toEqual([]);
  });
});

describe('noExtraRunLine', () => {
  it('says plainly that nothing extra ran', () => {
    expect(noExtraRunLine()).toMatch(/no e2e spec changed.*390x844 only/i);
  });
});
