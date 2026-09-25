import { describe, it, expect } from 'vitest';
import { formatAge } from '../../src/services/age';

const NOW = new Date('2026-09-24T12:00:00Z').getTime();

describe('formatAge', () => {
  it('shows "just now" for anything under a minute old', () => {
    expect(formatAge('2026-09-24T11:59:31Z', NOW)).toBe('just now');
  });

  it('shows minutes, singular and plural', () => {
    expect(formatAge('2026-09-24T11:59:00Z', NOW)).toBe('1 min ago');
    expect(formatAge('2026-09-24T11:58:00Z', NOW)).toBe('2 min ago');
  });

  it('shows hours, singular and plural', () => {
    expect(formatAge('2026-09-24T11:00:00Z', NOW)).toBe('1 hour ago');
    expect(formatAge('2026-09-24T09:00:00Z', NOW)).toBe('3 hours ago');
  });

  it('shows days, singular and plural', () => {
    expect(formatAge('2026-09-23T12:00:00Z', NOW)).toBe('1 day ago');
    expect(formatAge('2026-09-20T12:00:00Z', NOW)).toBe('4 days ago');
  });
});
