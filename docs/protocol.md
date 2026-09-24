# Postern message protocol

The one spec both rigs implement: the PWA (this repo, `src/services/messages.ts`) and
the Go backend's real adapters (`mw-1589l.11`, `infrastructure/postern`). Everything
below is testnet only, per `docs/research/messages.md`.

## 1. The record payload

A message is an `nftgate` record, version 1 (`RECORD_VERSION_PLAINTEXT`, the plaintext
JSON envelope `spell-forge-bsv`'s `record.ts` already defines), with a new `kind: 'msg'`
JSON shape that only postern understands:

```json
{
  "v": 1,
  "kind": "msg",
  "class": "message",
  "to": "<recipient compressed public key hex>",
  "from": "<sender compressed public key hex>",
  "ts": 1758700000,
  "ct": "<base64 BRC-78 EncryptedMessage ciphertext of the UTF-8 text>"
}
```

- `v` — always `1`. Matches the record's own version byte; carried in the payload too
  so a payload read outside the record framing (e.g. from `docs/api.md`'s
  `GET /api/messages` JSON) is still self-describing.
- `kind` — always `"msg"`.
- `class` — one of `"message"`, `"decision-needed"`, `"landing"`, `"alarm"`
  (`mw-f758y.5`). Sits in the clear beside the ciphertext on purpose
  (`mw-f758y.9` Q1): a classified-push backend, or anyone else reading the chain,
  can act on the class (e.g. wake the Mayor for `alarm`) without holding either
  party's private key.
- `to` / `from` — compressed secp256k1 public keys, hex, 33 bytes (66 hex chars).
  The same keys BRC-78 embeds inside the ciphertext itself (see below) — carried
  here too so a reader can tell who a message is for/from without decrypting it.
- `ts` — Unix seconds (not milliseconds, and not the ISO-8601 string
  `spell-forge-bsv`'s own `{text, ts}` shape uses) when the sender built the message.
  BRC-78 gives no replay protection, so this is informational only, not a security
  boundary.
- `ct` — the BRC-78 `EncryptedMessage.encrypt` output, base64-encoded. Encrypt input is
  the UTF-8 bytes of the plaintext message body; nothing else is wrapped in the
  ciphertext (the class tag, timestamp, and both public keys already travel in the
  clear in the fields above).

This payload is UTF-8 JSON, `JSON.stringify`'d and pushed as the one opaque payload
push of the record script — exactly what `encodeRecordScript` from `spell-forge-bsv`
builds: `OP_FALSE OP_RETURN <push 'nftgate'> <push 0x01> <push payload>`. Decoding a
`kind: 'msg'` payload is postern's own business, not `spell-forge-bsv`'s
`decodeRecordPayload` (that function only knows the undecorated `{text, ts}`,
`mint`, `transfer`, and `write` shapes) — postern parses the JSON itself after
`decodeRecordScript` hands back the raw payload bytes.

## 2. Encryption (BRC-78)

`EncryptedMessage`, re-exported by `spell-forge-bsv` from `@bsv/sdk`:

```
ct = base64(EncryptedMessage.encrypt(utf8Bytes(text), senderPrivateKey, recipientPublicKey))
text = utf8Decode(EncryptedMessage.decrypt(base64Decode(ct), recipientPrivateKey))
```

Sender authentication is implicit in the construction (decryption only succeeds if the
AES-GCM tag verifies, which requires the sender's own private key) — see
`docs/research/messages.md` §1 for the full construction and its limits (no forward
secrecy, no replay protection).

## 3. The anchor address

The postern message channel's own anchor address, testnet, distinct from
SpellForge's leaderboard anchor:

```
mt6vaAWeFxu2qC6pPs7bsqTNvv87dCwMW5
```

Nothing ever spends from this address — it only ever receives the 1-sat payment every
message output makes, the same way `spell-forge-bsv`'s own `chainConfig.anchorAddress`
works today. The Go backend's `POSTERN_ANCHOR` environment variable (`docs/api.md`)
must be set to this value for the two sides to agree on what the poller watches.

## 4. The transaction

One P2PKH-funded transaction, the same shape `spell-forge-bsv`'s `write-record.ts`
already builds for version-1 records (`buildRecordTransaction`), but built directly
against `docs/api.md`'s `/api/utxos` and `/api/broadcast` rather than through a
`ChainProvider`, since the PWA never talks to WhatsOnChain directly:

1. One P2PKH input per UTXO returned by `GET /api/utxos/{address}` for the sender's
   own address (excluding any 1-satoshi UTXO — that's a token, not fee money, same
   rule `selectFeeUtxos` applies).
2. Output 0 — the record (0 sat): `OP_FALSE OP_RETURN <'nftgate'> <0x01> <payload>`.
3. Output 1 — the 1-sat anchor payment, to the address in §3.
4. Output 2 — change, back to the sender's own address.
5. Fee computed by `SatoshisPerKilobyte` at `spell-forge-bsv`'s
   `chainConfig.feeRateSatPerKb` (1 sat/kB on testnet today).
6. Signed with the sender's unlocked key, then broadcast as `POST /api/broadcast`
   `{ "rawtx": "<hex>" }` (`docs/api.md`).

## 5. Decrypt test vectors

Both sides — this repo's `tests/unit/messages.test.ts` and the Go backend's BRC-78
implementation (`mw-1589l.11`) — must decrypt these to the stated plaintext.

### Vector 1

- Recipient private key (hex): `00000000000000000000000000000000000000000000000000000000000007d2`
- Payload:

  ```json
  {
    "v": 1,
    "kind": "msg",
    "class": "message",
    "to": "029cbf013d04ca50ba852816c2802b06ca5ed37b44be9597fc0f95360e209afa97",
    "from": "039d1abaec9f5715a15c7628244170951e0f85e87f68ca5393d3f9fc3fa23a69c8",
    "ts": 1758700000,
    "ct": "QkIQMwOdGrrsn1cVoVx2KCRBcJUeD4Xof2jKU5PT+fw/ojppyAKcvwE9BMpQuoUoFsKAKwbKXtN7RL6Vl/wPlTYOIJr6ly29yXkTykfSVSTrUVnERI/lCUsFLuvVhgyN79hFczet0W67HhaxJRMUSM/BXPUDPdFB/gQbllS0XYOgVPldzejkyjylJbipQqP4YgfBX9ZMXE8wgY4FS6wVF6bMvLwC4WA0bupV8apiP8jK9Q=="
  }
  ```
- Expected plaintext: `meet at the usual place, 6pm`

### Vector 2

- Recipient private key (hex): `0000000000000000000000000000000000000000000000000000000000000fa4`
- Payload:

  ```json
  {
    "v": 1,
    "kind": "msg",
    "class": "decision-needed",
    "to": "02874de6497645f144d1b63414c7b4310105089b0b4c6b6fb6e7da41125e90b471",
    "from": "03e5476b1ea99b6a08837315427a3751b83d685b34acc5201e59e9b623ac4b6941",
    "ts": 1758700400,
    "ct": "QkIQMwPlR2seqZtqCINzFUJ6N1G4PWhbNKzFIB5Z6bYjrEtpQQKHTeZJdkXxRNG2NBTHtDEBBQibC0xrb7bn2kESXpC0cbM6gO2NZNOn5Iz/TcKX9UJf1MFREN5HCDjA23O4C6POBw/H7qR/m9WhhXQsehQACPXAxJjrzl0bQ718ELXVfIM9HmSaGpR79cQohxzYgr8TjuLXukmz6Q5DYiiWqTN3XbIgiWFY"
  }
  ```
- Expected plaintext: `ratify the treaty now`

Both vectors were generated directly against `@bsv/sdk` 2.2.0's `EncryptedMessage.encrypt`
(fixed, deterministic sender/recipient private keys), then round-tripped through
`EncryptedMessage.decrypt` to confirm correctness before being recorded here.
