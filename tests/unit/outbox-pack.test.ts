// tests/unit/outbox-pack.test.ts — mw-8xe671n: a 2 MB photo's base64 for the outbox row is made by the browser's own
// FileReader (packFile), not by packBytes in the page's main thread; both write the same text.
import { describe, expect, it } from 'vitest';
import { packBytes, packFile } from '../../src/services/outbox';

describe('packFile (mw-8xe671n)', () => {
  it('writes the same base64 as packBytes, for a file and for nothing', async () => {
    const bytes = new Uint8Array(100_003).map((_, i) => (i * 13 + 5) % 256);
    expect(await packFile(bytes)).toBe(packBytes(bytes));
    expect(await packFile(new Uint8Array(0))).toBe('');
  });
});
