import { describe, it, expect } from 'vitest';
import { sortEpics, sortLanded, sortNeedsYou, sortWorking } from '../../src/projects/grouping';
import type { SnapshotEpic, SnapshotLanded, SnapshotNeedsYou, SnapshotWorking } from '../../src/services/questions';

function epic(overrides: Partial<SnapshotEpic> & { id: string }): SnapshotEpic {
  return {
    title: overrides.id,
    priority: 'P2',
    status: 'in-progress',
    needs_you: [],
    landed: [],
    working: [],
    closed_count: 0,
    ...overrides,
  };
}

describe('sortEpics', () => {
  it('floats an epic holding a question above a higher-priority epic with none', () => {
    const highPriorityNoQuestion = epic({ id: 'high', priority: 'P0' });
    const lowPriorityWithQuestion = epic({
      id: 'low',
      priority: 'P2',
      needs_you: [{ id: 'b1', title: 'q', asked_at: '2026-09-24T00:00:00Z', recommended: 'ship', options: [] }],
    });
    expect(sortEpics([highPriorityNoQuestion, lowPriorityWithQuestion]).map((e) => e.id)).toEqual(['low', 'high']);
  });

  it('otherwise orders by priority', () => {
    const p2 = epic({ id: 'p2', priority: 'P2' });
    const p0 = epic({ id: 'p0', priority: 'P0' });
    const p1 = epic({ id: 'p1', priority: 'P1' });
    expect(sortEpics([p2, p0, p1]).map((e) => e.id)).toEqual(['p0', 'p1', 'p2']);
  });
});

describe('sortNeedsYou', () => {
  it('orders oldest first', () => {
    const items: SnapshotNeedsYou[] = [
      { id: 'newer', title: 'newer', asked_at: '2026-09-24T10:00:00Z', recommended: 'a', options: [] },
      { id: 'older', title: 'older', asked_at: '2026-09-23T10:00:00Z', recommended: 'a', options: [] },
    ];
    expect(sortNeedsYou(items).map((i) => i.id)).toEqual(['older', 'newer']);
  });
});

describe('sortLanded', () => {
  it('orders newest first', () => {
    const items: SnapshotLanded[] = [
      { id: 'older', title: 'older', landed_at: '2026-09-23T10:00:00Z' },
      { id: 'newer', title: 'newer', landed_at: '2026-09-24T10:00:00Z' },
    ];
    expect(sortLanded(items).map((i) => i.id)).toEqual(['newer', 'older']);
  });
});

describe('sortWorking', () => {
  it('puts in-progress before ready regardless of priority', () => {
    const items: SnapshotWorking[] = [
      { id: 'ready-p0', title: 'ready', status: 'ready', priority: 'P0', updated_at: '2026-09-24T10:00:00Z', waits: [] },
      {
        id: 'in-progress-p2',
        title: 'working',
        status: 'in-progress',
        priority: 'P2',
        updated_at: '2026-09-24T09:00:00Z',
        waits: [],
      },
    ];
    expect(sortWorking(items).map((i) => i.id)).toEqual(['in-progress-p2', 'ready-p0']);
  });

  it('orders by priority within the same status', () => {
    const items: SnapshotWorking[] = [
      { id: 'ready-p2', title: 'a', status: 'ready', priority: 'P2', updated_at: '2026-09-24T10:00:00Z', waits: [] },
      { id: 'ready-p0', title: 'b', status: 'ready', priority: 'P0', updated_at: '2026-09-24T10:00:00Z', waits: [] },
    ];
    expect(sortWorking(items).map((i) => i.id)).toEqual(['ready-p0', 'ready-p2']);
  });
});
