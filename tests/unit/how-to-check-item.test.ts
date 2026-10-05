// tests/unit/how-to-check-item.test.ts — mw-581qad.2: which post in a channel carries the newest HOW TO CHECK IT.
import { describe, expect, it } from 'vitest';
import { howToCheckItemId } from '../../src/model/verified';

const item = (id: string, at: number, text: string) => ({ id, at, text });

describe('howToCheckItemId', () => {
  it('is the newest item that carries the marker, whoever wrote it', () => {
    const items = [item('builder', 10, 'Done.\n\nHOW TO CHECK IT, for the Governor:\n1. Open it'), item('mayor', 20, 'HOW TO CHECK IT\n1. Open it\nType VERIFIED here when it looks right.'), item('later', 30, 'Thanks')];
    expect(howToCheckItemId(items)).toBe('mayor');
  });
  it('is the Builder comment when the Mayor did not post', () => {
    expect(howToCheckItemId([item('builder', 10, 'HOW TO CHECK IT'), item('chat', 20, 'hello')])).toBe('builder');
  });
  it('is undefined when nothing carries it, and the marker is case-sensitive', () => {
    expect(howToCheckItemId([item('a', 1, 'how to check it'), item('b', 2, 'How to check it')])).toBeUndefined();
    expect(howToCheckItemId([])).toBeUndefined();
  });
});
