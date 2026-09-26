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
- `thread` — never a field of this clear envelope. Every message's plaintext (what
  `ct` encrypts) MAY itself name the thread it belongs to, `{"bead": "mw-xyz12.3"}`
  or `{"topic": "<name>"}`; absent, it's the general thread. See §6.

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

A sender can read its own message back later too, with no second copy and no format
change. `EncryptedMessage.encrypt`'s envelope (`version(4B) || senderPubKey(33B) ||
recipientPubKey(33B) || keyID(32B) || AES-GCM ciphertext`) carries the recipient's
public key and the random `keyID` in the clear, and the AES-GCM key is derived from a
BRC-42 child of the sender's private key and the recipient's public key. So the sender,
holding its own private key and already knowing the recipient's public key, can
recompute the same symmetric key straight from the header — the same derivation
`encrypt` ran, from the other side. `EncryptedMessage.decrypt` itself refuses this (it
insists the caller's key match the header's recipient), so `src/services/messages.ts`'s
`decryptMessageAsSender` rebuilds the derivation directly from `@bsv/sdk`'s exported
`PrivateKey`, `PublicKey` and `SymmetricKey` primitives, never a copy of the SDK's own
`encrypt`/`decrypt` functions. `v` stays `1` — this is a second way of reading the
existing envelope, not a new one.

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

### Machine-checkable vectors

`scripts/generate-fixture.ts` (`npm run fixture`) builds a fourth, fully machine-checkable
fixture from a fixed sender/recipient key pair, a fixed plaintext and a fixed fake UTXO, with
randomness pinned so its output never changes between runs. It writes
`docs/fixtures/protocol-vectors.json`: the fixed inputs, `encryptMessage`'s output,
`encodeRecordScript`'s hex, and a fully signed send transaction (raw hex and txid) built the
same way `src/services/send.ts` builds one. `features/fixture.feature` re-runs the generator
and asserts its output is byte-identical to the committed file, so it cannot drift; the Go
backend's own tests (`mw-1589l.18`) check `Cipher`, the record script and the send tx against
this same file instead of hand-derived vectors.

## 6. Questions and replies

The envelope from §1 is unchanged for a question or a reply — same `{v, kind, class,
to, from, ts, ct}` payload, same BRC-78 encryption. What differs is the shape of the
decrypted plaintext `ct` wraps, for two of the four classes (decided on `mw-f758y.2`):

- **A question** — `class: "decision-needed"`. The decrypted plaintext MAY be UTF-8
  JSON:

  ```json
  { "bead": "mw-xyz12.3", "q": "<the question>", "rec": "<recommended option label>", "options": ["<label>", "<label>", "..."] }
  ```

  - `bead` — the bead id the reply becomes a comment on (`mw-f758y.2`'s "How it
    becomes his word on a bead").
  - `q` — the question text; the app's Play control reads it aloud.
  - `rec` — the Mayor's recommended option, one of `options`.
  - `options` — the short labels the app renders as buttons.

- **A reply** — `class: "message"`, same as any other message. The decrypted
  plaintext MAY be UTF-8 JSON:

  ```json
  { "bead": "mw-xyz12.3", "answer": "<option label, or free text>" }
  ```

  - `bead` — names which question this answers.
  - `answer` — one of the question's `options` labels (a tap) or free text (typed
    or dictated).

A decrypted plaintext that does not parse as a JSON object with a string `bead`
field is plain text, exactly as today — an old message, or any `message` /
`landing` / `alarm` payload that was never structured, is shown as-is rather than
as a question or a reply. `src/services/questions.ts`'s `isStructured` makes that
check; `decodeQuestion` and `decodeReply` return `undefined` for anything that
fails it.

### Threads

Independently of `class`, any message's decrypted plaintext MAY instead be this
JSON shape, naming the thread it belongs to (`mw-f758y.21`, one thread per bead
automatically plus named topics he opens):

```json
{ "thread": { "bead": "mw-xyz12.3" }, "text": "<the message text>" }
```

or

```json
{ "thread": { "topic": "<name>" }, "text": "<the message text>" }
```

- `thread` — optional. `{"bead": "<id>"}` names the automatic thread that bead
  already has; `{"topic": "<name>"}` names a topic he opened. Absent — or the
  plaintext isn't this JSON shape at all, just bare text — means the general
  thread, exactly as every message reads today.
- `text` — the message body: exactly what an unthreaded plaintext already carries
  as its whole value, just wrapped alongside the thread it belongs to.

A `decision-needed` message, and its reply, never carry this shape: the `bead`
field each already has (above) names its thread directly — that bead IS its
thread, so a second `thread` field would only duplicate it. `src/services/threads.ts`'s
`threadOf(class, plaintext)` returns the thread any decrypted message belongs to
across every class: the question or reply's own `bead` for `decision-needed` and
its reply, this `thread` field (if present) for anything else, or `undefined` for
the general thread. `encodeThreadedMessage` / `decodeThreadedMessage` there
build and read the `{ thread, text }` shape above.

### Question and reply vectors

Both built with the same two fixed private keys as §5's vectors — no new keys
introduced. `tests/unit/questions.test.ts` decrypts each with `decryptMessage`
(§2) and decodes the result with `decodeQuestion` / `decodeReply`.

**Question vector** — recipient private key (hex):
`0000000000000000000000000000000000000000000000000000000000000fa4`

```json
{
  "v": 1,
  "kind": "msg",
  "class": "decision-needed",
  "to": "02874de6497645f144d1b63414c7b4310105089b0b4c6b6fb6e7da41125e90b471",
  "from": "029cbf013d04ca50ba852816c2802b06ca5ed37b44be9597fc0f95360e209afa97",
  "ts": 1758700800,
  "ct": "QkIQMwKcvwE9BMpQuoUoFsKAKwbKXtN7RL6Vl/wPlTYOIJr6lwKHTeZJdkXxRNG2NBTHtDEBBQibC0xrb7bn2kESXpC0cfUTYJju0iaS49EXvwfnOFzmhXmTg2rkY/fKFZoWPWIsnOlK+qTGT8mzFDsasyjArVmGLaN6keDBmn8ZIfxI188ceMVf3fH5lYyAHkijb5uR4kicdu5LSostB3XRPNRG/mHRhKgdfYFLR1jaUI0YhyQpegvb7HHEt1BJMypStI6QVsDa2beMuIwLtbqxPe3cPlQjPSx0xOyX+G2I35GTn4ed4yjqKBIFnlu6U1I8T6gGRi3eB8z2Idocga1v6yKsMSra77q67aRH"
}
```

Expected decrypted plaintext:
`{"bead":"mw-xyz12.3","q":"Ship the walking skeleton now, or wait for WireGuard?","rec":"ship","options":["ship","wait"]}`

**Reply vector** — recipient private key (hex):
`00000000000000000000000000000000000000000000000000000000000007d2`

```json
{
  "v": 1,
  "kind": "msg",
  "class": "message",
  "to": "029cbf013d04ca50ba852816c2802b06ca5ed37b44be9597fc0f95360e209afa97",
  "from": "02874de6497645f144d1b63414c7b4310105089b0b4c6b6fb6e7da41125e90b471",
  "ts": 1758700900,
  "ct": "QkIQMwKHTeZJdkXxRNG2NBTHtDEBBQibC0xrb7bn2kESXpC0cQKcvwE9BMpQuoUoFsKAKwbKXtN7RL6Vl/wPlTYOIJr6l9PDCCGbY3BqZlHrHfCoyORKwY0btt9/QgpmhChCxOi8NqdursM7raS+G938sW5LkBrVg9m8QRX5z+9ZljftaweMkdRKiRB1jaZ9zmbcHnFJZfg5ZzC3ZE+R9NB/5nJ7bfEJFoOo4vQgtg6kcFS/maO/8nS4Bw=="
}
```

Expected decrypted plaintext: `{"bead":"mw-xyz12.3","answer":"ship"}`

## 7. The snapshot

Decided on `mw-f758y.2` ("Where the data comes from", Q1 "A"): rather than a chain
reader or a daemon on the app's side, each notifier tick on the VPS
(`contrib/mail-notify`, inside its lock) writes one snapshot of every live epic and
open question, encrypted to the Governor's own public key with the same BRC-78
envelope §2 describes (`mw postern snapshot` writes it; the tick calls it), and
served by nginx beside `/api` at `https://postern.allmymind.org/snapshot`. The app
fetches it on open and on pull-to-refresh, decrypts it with the unlocked key, and
keeps the last good copy in Dexie for offline use.

The response is the raw BRC-78 ciphertext bytes, base64-encoded as the response
body text (not wrapped in the `{v, kind, class, to, from, ts, ct}` envelope — there
is exactly one recipient and one purpose, so the envelope's fields carry nothing
the client doesn't already know), with `Cache-Control: no-store` so a stale copy is
never served from an intermediate cache:

```
ct = base64(EncryptedMessage.encrypt(utf8Bytes(JSON.stringify(snapshot)), mayorPrivateKey, governorPublicKey))
```

`src/services/questions.ts`'s `decodeSnapshot(plaintext)` parses the decrypted
`JSON.stringify(snapshot)` text back into the typed shape below.

### Snapshot contract

The decrypted plaintext is this JSON shape exactly (Mayor's reading of
`mw-f758y.2`, provisional — the Governor to confirm against the epic tree):

```json
{
  "written_at": "<ISO-8601 timestamp>",
  "epics": [
    {
      "id": "<bead id>",
      "title": "<epic title>",
      "priority": "<P0..P3>",
      "status": "<epic status>",
      "needs_you": [
        { "id": "<bead id>", "title": "<title>", "asked_at": "<ISO-8601>", "recommended": "<option label>", "options": ["<label>", "..."] }
      ],
      "landed": [
        { "id": "<bead id>", "title": "<title>", "landed_at": "<ISO-8601>" }
      ],
      "working": [
        { "id": "<bead id>", "title": "<title>", "status": "<status>", "priority": "<P0..P3>", "updated_at": "<ISO-8601>", "waits": ["<bead id>", "..."] }
      ],
      "closed_count": 0
    }
  ]
}
```

- `needs_you` — decision-needed questions still open: a question appears here from
  the send of its `decision-needed` message until a reply naming its bead is on
  the bead (`mw-f758y.2`'s "How it becomes his word on a bead").
- `landed` — landings not yet verified.
- `working` — in-progress stories, then the frontier by priority; `waits` names
  the bead ids it waits on.
- `closed_count` — everything else, collapsed to a count.
