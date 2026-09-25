import { describe, it, expect } from 'vitest';
import { PrivateKey } from '@bsv/sdk';
import { encryptMessage, decryptMessage, decryptMessageAsSender, ANCHOR_ADDRESS } from '../../src/services/messages';

// The two decrypt vectors recorded in docs/protocol.md §5 — the Go backend's
// BRC-78 implementation (mw-1589l.11) must pass these too.
const VECTOR_1 = {
  recipientPrivateKeyHex: '00000000000000000000000000000000000000000000000000000000000007d2',
  payload: {
    v: 1 as const,
    kind: 'msg' as const,
    class: 'message' as const,
    to: '029cbf013d04ca50ba852816c2802b06ca5ed37b44be9597fc0f95360e209afa97',
    from: '039d1abaec9f5715a15c7628244170951e0f85e87f68ca5393d3f9fc3fa23a69c8',
    ts: 1758700000,
    ct: 'QkIQMwOdGrrsn1cVoVx2KCRBcJUeD4Xof2jKU5PT+fw/ojppyAKcvwE9BMpQuoUoFsKAKwbKXtN7RL6Vl/wPlTYOIJr6ly29yXkTykfSVSTrUVnERI/lCUsFLuvVhgyN79hFczet0W67HhaxJRMUSM/BXPUDPdFB/gQbllS0XYOgVPldzejkyjylJbipQqP4YgfBX9ZMXE8wgY4FS6wVF6bMvLwC4WA0bupV8apiP8jK9Q==',
  },
  expectedPlaintext: 'meet at the usual place, 6pm',
};

const VECTOR_2 = {
  recipientPrivateKeyHex: '0000000000000000000000000000000000000000000000000000000000000fa4',
  payload: {
    v: 1 as const,
    kind: 'msg' as const,
    class: 'decision-needed' as const,
    to: '02874de6497645f144d1b63414c7b4310105089b0b4c6b6fb6e7da41125e90b471',
    from: '03e5476b1ea99b6a08837315427a3751b83d685b34acc5201e59e9b623ac4b6941',
    ts: 1758700400,
    ct: 'QkIQMwPlR2seqZtqCINzFUJ6N1G4PWhbNKzFIB5Z6bYjrEtpQQKHTeZJdkXxRNG2NBTHtDEBBQibC0xrb7bn2kESXpC0cbM6gO2NZNOn5Iz/TcKX9UJf1MFREN5HCDjA23O4C6POBw/H7qR/m9WhhXQsehQACPXAxJjrzl0bQ718ELXVfIM9HmSaGpR79cQohxzYgr8TjuLXukmz6Q5DYiiWqTN3XbIgiWFY',
  },
  expectedPlaintext: 'ratify the treaty now',
};

describe('messages: protocol.md decrypt vectors', () => {
  it('decrypts vector 1 to the stated plaintext', () => {
    expect(decryptMessage(VECTOR_1.payload, VECTOR_1.recipientPrivateKeyHex)).toBe(VECTOR_1.expectedPlaintext);
  });

  it('decrypts vector 2 to the stated plaintext', () => {
    expect(decryptMessage(VECTOR_2.payload, VECTOR_2.recipientPrivateKeyHex)).toBe(VECTOR_2.expectedPlaintext);
  });
});

describe('messages: encryptMessage / decryptMessage', () => {
  it('names the testnet channel anchor address', () => {
    expect(ANCHOR_ADDRESS).toBe('mt6vaAWeFxu2qC6pPs7bsqTNvv87dCwMW5');
  });

  it('round-trips a message for its recipient', () => {
    const sender = PrivateKey.fromRandom();
    const recipient = PrivateKey.fromRandom();
    const payload = encryptMessage({
      text: 'the gate is open',
      class: 'message',
      senderPrivateKeyHex: sender.toHex(),
      recipientPublicKeyHex: recipient.toPublicKey().toString(),
      ts: 1758700000,
    });

    expect(decryptMessage(payload, recipient.toHex())).toBe('the gate is open');
  });

  it('cannot be decrypted by a key other than the intended recipient', () => {
    const sender = PrivateKey.fromRandom();
    const recipient = PrivateKey.fromRandom();
    const eavesdropper = PrivateKey.fromRandom();
    const payload = encryptMessage({
      text: 'only the Mayor should read this',
      class: 'message',
      senderPrivateKeyHex: sender.toHex(),
      recipientPublicKeyHex: recipient.toPublicKey().toString(),
    });

    expect(() => decryptMessage(payload, eavesdropper.toHex())).toThrow();
  });

  it('records v, kind, class, to, from and ts in the clear beside the ciphertext', () => {
    const sender = PrivateKey.fromRandom();
    const recipient = PrivateKey.fromRandom();
    const payload = encryptMessage({
      text: 'evacuate the north tower',
      class: 'alarm',
      senderPrivateKeyHex: sender.toHex(),
      recipientPublicKeyHex: recipient.toPublicKey().toString(),
      ts: 1758700500,
    });

    // Simulates a chain reader with no private key at all: parse the JSON payload
    // straight off the wire and read the class tag without ever calling decrypt.
    const wireForm = JSON.parse(JSON.stringify(payload)) as typeof payload;
    expect(wireForm).toEqual({
      v: 1,
      kind: 'msg',
      class: 'alarm',
      to: recipient.toPublicKey().toString(),
      from: sender.toPublicKey().toString(),
      ts: 1758700500,
      ct: expect.any(String),
    });
    expect(wireForm.ct).not.toContain('evacuate');
  });
});

describe('messages: decryptMessageAsSender (mw-1589l.27 AC1)', () => {
  it('lets the sender read its own message back, the same as the recipient', () => {
    const sender = PrivateKey.fromRandom();
    const recipient = PrivateKey.fromRandom();
    const payload = encryptMessage({
      text: 'meet at the usual place, 6pm',
      class: 'message',
      senderPrivateKeyHex: sender.toHex(),
      recipientPublicKeyHex: recipient.toPublicKey().toString(),
    });

    expect(decryptMessageAsSender(payload, sender.toHex())).toBe('meet at the usual place, 6pm');
    expect(decryptMessage(payload, recipient.toHex())).toBe('meet at the usual place, 6pm');
  });

  it('fails with a clear error for the recipient key, not the sender', () => {
    const sender = PrivateKey.fromRandom();
    const recipient = PrivateKey.fromRandom();
    const payload = encryptMessage({
      text: 'meet at the usual place, 6pm',
      class: 'message',
      senderPrivateKeyHex: sender.toHex(),
      recipientPublicKeyHex: recipient.toPublicKey().toString(),
    });

    expect(() => decryptMessageAsSender(payload, recipient.toHex())).toThrow();
  });

  it('fails with a clear error for an unrelated key', () => {
    const sender = PrivateKey.fromRandom();
    const recipient = PrivateKey.fromRandom();
    const stranger = PrivateKey.fromRandom();
    const payload = encryptMessage({
      text: 'meet at the usual place, 6pm',
      class: 'message',
      senderPrivateKeyHex: sender.toHex(),
      recipientPublicKeyHex: recipient.toPublicKey().toString(),
    });

    expect(() => decryptMessageAsSender(payload, stranger.toHex())).toThrow();
  });
});
