// tests/unit/send-error-words.test.ts — mw-qkb7yp: the toast a failed send shows never carries WhatsOnChain's page or its "said 429".
import { describe, expect, it, vi } from 'vitest';
import { describeSendError } from '../../src/cockpit/send';

describe('describeSendError', () => {
  it("turns a relayed provider page into one plain line and keeps the page for the console", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const words = describeSendError(new Error('WhatsOnChain said 429: <html><title>429 Too Many Requests</title></html>'));
    expect(words).toBe('WhatsOnChain is rate-limiting us. Try again in a minute.');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("leaves the backend's own short words as they are", () => {
    expect(describeSendError(new Error('the transaction was rejected'))).toBe('the transaction was rejected');
  });
});
