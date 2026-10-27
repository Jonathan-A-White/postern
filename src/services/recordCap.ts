// src/services/recordCap.ts — how much one record may carry (mw-fjpe9tx). No imports: the model, the
// service worker and the senders all read it.

/** The most a record's payload may be: spell-forge-bsv's encodeRecordScript throws past it, on the phone, before any request. */
export const RECORD_PAYLOAD_MAX_BYTES = 10 * 1024;

/**
 * The most plaintext one record seals. The payload is the plaintext sealed (BRC-78 adds 150 bytes), base64'd (a third
 * more) and set in the envelope (about 410 bytes with both keys): 7,200 bytes make a payload of about 10,010, under
 * RECORD_PAYLOAD_MAX_BYTES whatever the class. A message over it goes as several records (threads.ts messageRecords).
 */
export const RECORD_PLAINTEXT_MAX_BYTES = 7_200;
