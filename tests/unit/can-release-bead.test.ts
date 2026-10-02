// tests/unit/can-release-bead.test.ts — mw-tcmhmh.1: Release un-holds a bead so dispatch takes
// it; dispatch needs a rig and a target branch, so a bead without both has nothing to release.
import { describe, expect, it } from 'vitest';
import { hasDispatchPath } from '../../src/model/view';
import type { BeadPath } from '../../src/model/view';

const full: BeadPath = { rig: 'postern', branch: 'main', host: 'laptop', model: 'sonnet', effort: 'high', formula: 'tdd-feature', harness: 'claude' };

describe('hasDispatchPath', () => {
  it('is true when the path names a rig and a target branch', () => {
    expect(hasDispatchPath(full)).toBe(true);
    expect(hasDispatchPath({ ...full, host: '', model: '', effort: '', formula: '', harness: '' })).toBe(true);
  });

  it('is false when there is no path at all', () => {
    expect(hasDispatchPath(undefined)).toBe(false);
  });

  it('is false when the rig is missing', () => {
    expect(hasDispatchPath({ ...full, rig: '' })).toBe(false);
  });

  it('is false when the target branch is missing', () => {
    expect(hasDispatchPath({ ...full, branch: '' })).toBe(false);
  });
});
