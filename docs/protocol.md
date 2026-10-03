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
  "ct": "<base64 BRC-78 EncryptedMessage ciphertext of the UTF-8 text>",
  "summary": "Answer: <bead title>"
}
```

- `v` — always `1`. Matches the record's own version byte; carried in the payload too
  so a payload read outside the record framing (e.g. from `docs/api.md`'s
  `GET /api/messages` JSON) is still self-describing.
- `kind` — always `"msg"`.
- `class` — one of `"message"`, `"decision-needed"`, `"landing"`, `"alarm"`
  (`mw-f758y.5`), `"move-home"` (§18), `"grist"` (an app's AI work for the
  factory and its answer, §19), `"talk"` (a turn on the Talk line, §20), `"call"` (a call record, §21), `"events"` (a batch of factory events, §22), `"card"` (a live card, §24) or `"card-update"` (a change to one, §24). Sits in the clear beside the ciphertext on purpose
  (`mw-f758y.9` Q1): a classified-push backend, or anyone else reading the chain,
  can act on the class (e.g. wake the Mayor for `alarm`) without holding either
  party's private key.
- `role` — optional, only on a `call` record (§21): `"request"`, `"ring"` or `"later"`,
  in the clear beside `class` so the backend can push a ring and nothing else of a call.
  Any other record ignores it.
- `lane` — optional, only on an `events` record (§22): `"emergency"` in the clear beside
  `class`, so the backend can push an emergency and nothing else of an events record. The
  sealed plaintext names the lane too; this copy is the one the backend reads. Any other
  record ignores it.
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
- `summary` — optional, a string of at most 80 runes: a bead title and an act
  (`"Answer: <title>"`), never a word of the message itself, but for the Mayor's ring
  (§21), whose summary is its short reason, the line he chose to show. It sits in the clear
  beside `ct`, so it is public to anyone who reads the record. A sender puts it only
  on a direct record (§9), never a chain one; the backend turns it into the web
  push's body (§9 item 6). A record without one is unchanged.
- `channel` / `bead` — optional, strings: the name of the channel a `message` belongs to, or
  the id of the bead whose channel it is, in the clear so the push's title can name it
  (`Message in general`, `Message on mw-xyz12.3`). A bead outranks a name; each is cut to 80
  runes. Like `summary` they are public to anyone who reads the record; a sender that wants
  a channel sealed leaves them off, and the push title stays `Message`.
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
`ChainProvider`, since the PWA does not talk to WhatsOnChain directly (the exceptions
are §21's, with the backend out of reach: a text post (a Call me among them) builds this same transaction and
lists coins and broadcasts at WhatsOnChain, and the phone reads the anchor address's
records back from WhatsOnChain itself):

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

Words (mw-909ci.5): the `thread` field names what the app calls a **channel**: a
bead's own channel (`{"bead": …}`), or a named one (`{"topic": …}`, which the app
shows as 'New channel' and a subtitle of 'Channel'; the word 'topic' is never on a
screen). What the app calls a **thread** is §14's replies under one post, found by
`re`. The wire keys (`thread`, `topic`, `bead`, `re`) and the stored keys are
unchanged.

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
        { "id": "<bead id>", "title": "<title>", "asked_at": "<ISO-8601>", "recommended": "<option label>", "options": ["<label>", "..."], "description": "<markdown, optional>", "comments": [{ "at": "<ISO-8601>", "text": "<markdown>" }] }
      ],
      "landed": [
        { "id": "<bead id>", "title": "<title>", "landed_at": "<ISO-8601>", "description": "<markdown, optional>", "comments": [{ "at": "<ISO-8601>", "text": "<markdown>" }] }
      ],
      "working": [
        { "id": "<bead id>", "title": "<title>", "status": "<status>", "priority": "<P0..P3>", "updated_at": "<ISO-8601>", "waits": ["<bead id>", "..."], "description": "<markdown, optional>", "comments": [{ "at": "<ISO-8601>", "text": "<markdown>" }] }
      ],
      "closed_count": 0
    }
  ]
}
```

- `needs_you` — decision-needed questions still open: a question appears here from
  the send of its `decision-needed` message until a reply naming its bead is on
  the bead (`mw-f758y.2`'s "How it becomes his word on a bead").
- `landed` — landings within the last 24 hours of `written_at`; an older landing
  leaves the list but stays counted in `closed_count`.
- `working` — in-progress stories, then the frontier by priority; `waits` names
  the bead ids it waits on.
- `closed_count` — everything else, collapsed to a count.
- `description` and `comments` — both optional (added by `mw-hy6f4.3`), on a
  `needs_you`, `landed` or `working` item: the bead's own description and up
  to its newest three comments (newest first). Both fields are Markdown text,
  capped at 4000 runes each with a trailing marker when cut, rendered by the
  app through the shared Markdown component (`mw-hy6f4.4`). A snapshot from
  before this addition carries neither field; the app renders such an item
  exactly as it always has.

## 8. Attachments

`mw-dxy1c`: one image per message, phone to Mayor only. The image bytes are
encrypted exactly as a message body is — the same BRC-78 `EncryptedMessage`
envelope §2 describes, from the sender's key to the recipient's public key —
and the resulting ciphertext is uploaded whole to the backend, so the
backend never sees plaintext image bytes.

### Upload

The ciphertext is the body of `POST /api/blobs` (`docs/api.md`, the same
`Authorization: Postern <pubkey>:<nonce>:<sig>` proof every endpoint but
`GET /api/challenge` requires):

- A body over 8 MiB plus 256 bytes of BRC-78 envelope overhead is refused
  `413`.
- `201 application/json` — a body not already stored:

  ```json
  { "hash": "<sha256 hex of the body as received>", "size": <bytes> }
  ```

- `200 application/json` — the same shape, for a repeat upload of bytes
  already stored (the existing blob is kept, not duplicated).

The backend keeps the body under `$POSTERN_DATA/blobs/<hash>` for 30 days
from upload, then deletes it. `GET /api/blobs/{hash}` (same auth) streams it
back as `application/octet-stream`; `404` once the hash is unknown or the
30 days have passed.

### The plaintext's attachment field

The message plaintext (what `ct` in §1's envelope encrypts) gains an
optional field beside `text` and `thread`:

```json
{
  "text": "<optional caption>",
  "attachment": {
    "hash": "<sha256 hex, matching POST /api/blobs's response>",
    "size": <ciphertext bytes>,
    "mime": "image/png|image/jpeg|image/webp"
  }
}
```

- `attachment` — absent for a message with no image. A message with an
  `attachment` and an empty (or absent) `text` is valid — a caption is
  optional, not required.
- `hash` / `size` — the same `hash` and `size` `POST /api/blobs` answered
  for this attachment's ciphertext, so a reader can fetch it with
  `GET /api/blobs/{hash}` and verify what it downloads before decrypting it.
- `mime` — the original image's content type, informational (the ciphertext
  itself carries no type information); one of `image/png`, `image/jpeg`, or
  `image/webp`.

### Several files in one message

`mw-909ci.3`: files sent together are ONE message. One file is the single
`attachment` above, exactly as before. Two or more go in `attachments`, an
array of those same `{ hash, size, mime }` objects in the order the sender
added them, with the caption as the message's `text` and the same `thread`
and `re`:

```json
{
  "thread": { "bead": "mw-abc.3" },
  "text": "<optional caption, for the whole post>",
  "attachments": [
    { "hash": "<sha256 hex>", "size": <ciphertext bytes>, "mime": "image/png" },
    { "hash": "<sha256 hex>", "size": <ciphertext bytes>, "mime": "image/jpeg" }
  ]
}
```

- A writer sets `attachment` or `attachments`, never both. A reader that finds
  both uses `attachments`.
- `attachments` is a non-empty array whose every entry is a valid attachment:
  one that is empty, not an array, or holds a malformed entry makes the whole
  body read as plain text, as any other malformed shape does.
- No new size cap: each file is still at most 8 MiB, and every file is uploaded
  before the message is sent, so a failed upload sends nothing.
- A list preview reads one file as its own label, two or more images as
  `2 images`, any other mix as `3 files`, then ` · caption`.

## 9. Direct delivery (the live channel)

The Governor's 2026-09-28 overhaul (vault `plans/0021-cockpit-plan.md`, decision 5):
BSV keeps identity and the licence gate; the conversation itself stops riding on
chain. A message is still exactly §1's record script — the same envelope, the same
BRC-78 ciphertext, the same `OP_FALSE OP_RETURN 'nftgate' 0x01 <payload>` bytes —
but instead of wrapping it in a transaction and broadcasting it, the sender posts
the script straight to the backend, which indexes it beside the chain's records.
Nothing about a message's privacy changes (the backend never holds a key that can
read `ct`); what changes is that delivery takes one HTTP round trip instead of a
funded transaction, a WhatsOnChain round trip and a 5-second poll.

`POST /api/messages`, authenticated like every endpoint (`docs/api.md`):

```json
{ "scriptHex": "<hex of the §1 record script>", "clientId": "<optional, see below>" }
```

`clientId` is the phone's outbox row's id (mw-jrx0s.23): 128 random bits as 32 hex
characters, made once when the row is written, kept in its Dexie row (so it survives a
restart) and sent with every try of that row. The backend accepts 1 to 128 letters,
digits, `-` or `_` (`400` otherwise).

The backend:

1. decodes the script as an `nftgate` version-1 record and parses its payload as
   §1's envelope — `v` 1, `kind` `"msg"`, a known `class`, 66-hex `to` and `from`,
   numeric `ts`, string `ct` — refusing anything else `400`;
2. refuses `403` unless `from` is the very key whose challenge signature
   authenticated the request (so a direct record's sender is proven, not claimed);
3. names the record `direct:<sha256 hex of the script bytes>` — its `txid` from
   here on, everywhere a txid appears (`GET /api/messages`, bead comments, the
   app's rows). The prefix is how any reader tells a direct record from a
   transaction: a real txid is 64 hex characters and never contains `:`;
4. stores it in the same index as on-chain records, with `vout` 0, `height` 0,
   `signer` = the authenticated key, and `chain` = `sha256(prevChain || id)` hex
   over every direct record in order (`prevChain` is the previous direct
   record's `chain`, or 64 zeros for the first; `id` is the UTF-8 bytes of the
   `direct:` name). `chain` is what a later anchoring job commits on chain for
   tamper evidence (decision 5's optional fingerprint); it is informational until
   then;
5. answers `201 {"txid": "direct:…", "seq": <n>}`, or `200` with the same shape
   when those exact script bytes are already stored (a retry is harmless);
   **A retry is not a second message.** The phone encrypts afresh on every try, so a
   retry of a send whose reply was lost has other bytes and so another `direct:` name.
   When the post carries a `clientId`, the backend therefore also remembers, per
   authenticated key, the ids it accepted in the last 24 hours (at most 20,000 are held,
   oldest first out; in memory, so a restart forgets them). A post whose key and
   `clientId` are remembered is answered `200` with the first acceptance's `txid` and
   `seq`, whatever script it carries; nothing is stored, pushed or evented a second
   time. Two rows with identical content have different ids and are two records. A post
   with no `clientId` is deduped by the script's bytes alone, as above;
6. then does everything the poller does for a newly indexed record: a web push to
   the recipient's subscriptions (whose body is the record's clear `summary`, cut to
   80 runes, when it has one and is a `message`, `decision-needed`, `landing` or
   `alarm`; §1), a `message` event on §10's stream, and the
   on-message hook (`POSTERN_ON_MESSAGE`, `docs/api.md`). A `talk` record or a
   `call` record or an `events` record or a `card` or `card-update` record gets the `message`
   event only (§20, §21, §22, §24: evented, never pushed), but
   for the Mayor's ring (a `call` record whose clear `role` is `ring`), which is pushed too,
   titled `The Mayor is calling`, its `summary` the body (§21).

A body over 256 KiB is refused `413`. The chain channel (§4) keeps working
unchanged: a reader must accept both kinds of record, in `seq` order.

## 10. The event stream

`GET /api/events`, authenticated, answers `text/event-stream` (with
`Cache-Control: no-store` and `X-Accel-Buffering: no`) and stays open:

```
event: hello
data: {"head": 42, "view": "<the current view's ETag, or empty>"}

event: message
data: {"seq": 43}

event: view
data: {"etag": "<the new view's ETag>"}

: ping
```

- `hello` — sent once on connect: the index head and the current view's ETag, so
  a client that reconnects knows at once whether it missed anything.
- `message` — a record was indexed (either channel); `seq` is its sequence number.
  The client pages `GET /api/messages?since=` from its own cursor.
- `view` — the view file (§11) changed.
- `: ping` — a comment line every 25 seconds, so a proxy never idles the stream out.

The app reads it with `fetch` (not `EventSource`, which cannot send the
`Authorization` header) and reconnects with a back-off from 1 to 30 seconds;
after any reconnect it syncs messages and revalidates the view.

A cockpit key may read the stream, and so may the Mayor's key
(`POSTERN_MAYOR_KEY`) with or without a licence (§20).

## 11. The live view

The live replacement for §7's snapshot, decision 6. `mw postern view` builds it on
the host that holds the beads database, whenever the beads change (at most every
`MW_MAIL_VIEW_EVERY` seconds, default 30), encrypts it to the Governor's key and
writes it atomically to `postern_view_path`; the backend serves that file:

`GET /api/view`, authenticated:

- `200 text/plain` — the file's bytes: `base64(EncryptedMessage.encrypt(gzip(utf8(JSON)), mayorKey, governorKey))`,
  with `ETag: "<sha256 hex of the file's bytes>"` and `Cache-Control: no-store`;
- `304` — the request's `If-None-Match` names the current ETag;
- `404` — no view has been written yet.

The plaintext bytes are gzip (RFC 1952) of the UTF-8 JSON below. A reader checks
for the gzip magic `1f 8b` and inflates; anything else it reads as UTF-8 JSON as
it stands. The BRC-78 header's sender key must equal the Mayor's pinned key (§15).

```json
{
  "v": 2,
  "written_at": "2026-09-28T12:00:00Z",
  "host": "desktop",
  "hosts": [{ "name": "desktop", "last_sync": "2026-09-28T11:59:10Z" }],
  "needs": [
    {
      "kind": "question",
      "bead": "mw-abc.3",
      "epic": "mw-abc",
      "title": "Which storage engine?",
      "since": "2026-09-28T10:00:00Z",
      "text": "<markdown>",
      "recommended": "A",
      "options": ["A", "B"],
      "blocks": 4,
      "waits_for": "you"
    }
  ],
  "beads": [
    {
      "id": "mw-abc.3",
      "title": "Pick the storage engine",
      "type": "task",
      "status": "open",
      "priority": 1,
      "parent": "mw-abc",
      "labels": ["hitl"],
      "assignee": "",
      "waits": ["mw-abc.2"],
      "created": "2026-09-27T09:00:00Z",
      "updated": "2026-09-28T10:00:00Z",
      "started": "",
      "closed": "",
      "path": { "rig": "postern", "branch": "main", "host": "desktop", "model": "sonnet", "effort": "high", "formula": "tdd-feature", "harness": "claude" },
      "attempts": 0,
      "summary": "<the description's first 280 runes>",
      "comments": 3,
      "done_earlier": 0
    }
  ]
}
```

`beads` — every live epic (open or in progress), every bead under one at any depth
(child epics included, each with its own children), and every live bead's
parent chain up to the root, so the app can draw any level of the tree:

- a closed bead is included only if it closed within the last 7 days; an epic's
  `done_earlier` counts its direct children that closed before that (so progress
  = closed children in `beads` + `done_earlier` over all children);
- `status` is the tracker's own word: `open`, `in_progress`, `deferred` (held),
  `closed`; `type` likewise (`epic`, `task`, `bug`, `feature`, `chore`, …); a map
  is an epic labelled `wayfinder:map`;
- `waits` — the ids of the unfinished beads this one waits on (so an open bead
  with an empty `waits` is on the frontier);
- `path` — the story's merged Path (the epic's defaults overlaid with its own);
  fields the tracker does not know are empty strings; absent on an epic with no
  defaults;
- times are RFC 3339 UTC, or `""` when unknown;
- `summary` — plain text; the full description, acceptance and every comment come
  from §12.

`needs` — everything waiting on the Governor, one entry each, most blocking first
(then oldest):

| `kind` | when | `options` |
| --- | --- | --- |
| `question` | a decision-needed question asked over the postern is still open on `bead` | the question's own |
| `approve` | a live epic has stories held (`deferred`) for his word: `bead` is the epic, `text` says how many | `["Release"]` |
| `verify` | a story closed in the last 24 hours with no `VERIFIED` comment | `["Verified"]` |
| `stale` | a bead that has gone stale: `since` is when it went stale; `text` is the facts (what it is, its age, what it waits on, the first 200 characters of its newest comment); it **replaces** the `approve` or `hands` need for the same bead, never both | `["Keep", "Close"]` |
| `demo` | an open bead labelled `demo` | `[]` |
| `hands` | an open bead labelled `hitl`: a step only his hands can do; its `steps` (§17) can be approved and run from the app | `[]` |
| `alarm` | a story that used up its attempts, or a host whose last sync is over 20 minutes old (`bead` empty) | `[]` |

The table is also the kinds' rank among equals: `stale` comes after `verify` and
before `demo`. A bead is never in `needs` as both `stale` and `approve`, or both
`stale` and `hands`: the `stale` need stands in for the other.

`blocks` — how many unfinished beads wait on `bead`, directly or through others.

Every need also says who it waits on, and a card that cannot be acted on yet says why:

| field | type | meaning |
| --- | --- | --- |
| `waits_for` | `"you"` \| `"mayor"` \| `"factory"` | who has to move next. Only a `you` card can be acted on now; the app lists the three apart and gives `mayor` and `factory` cards no buttons. Always present in `mw`'s output; a reader that finds it missing (an older `mw`) reads `you`, as every card was his then, and reads any other word as `you` too, so a newer word never hides a card |
| `not_ready` | bool | `true` on a card that cannot be acted on yet (a `hands` or `demo` card whose blockers are open or whose steps are unwritten, a `verify` card with nothing to check yet): it offers neither Approve, Done nor Verified. Absent when ready |
| `waiting_on` | string[] | on a `not_ready` card, what it waits on: the titles of its open blockers, or the Mayor's own words (`the Mayor to write the steps`, `the Mayor to check the landing`). Absent when ready |

`waits_for` by kind:

| `kind` | `waits_for` | rule |
| --- | --- | --- |
| `question` | `you` | an open question waits on his answer |
| `approve` | `you` | held stories wait on his Release |
| `verify` | `you`, or `mayor` | `you` when the landed story has a HOW TO CHECK IT section: that section (to the next heading, at most 1500 characters, image links kept) is the need's `text`. `mayor` when it has none (`not_ready`, `waiting_on` `the Mayor to check the landing`) |
| `stale` | `you` | he decides Keep or Close |
| `hands` | `you`, `factory` or `mayor` | `you` when it has steps and none of its bead's blockers is open, or when a comment opening `BY HAND` holds his instructions (no steps, and Done is live). `factory` while any blocker is open (`not_ready`, `waiting_on` their titles). `mayor` when it has no steps and no `BY HAND` comment (`not_ready`, `waiting_on` `the Mayor to write the steps`) |
| `demo` | `you` or `factory` | `you` when the bead has no open blocker; otherwise `factory`, `not_ready`, `waiting_on` the blockers' titles |
| `alarm` | `mayor` or `factory` | `mayor` for a story that used up its attempts; `factory` for a host whose last sync is over 20 minutes old |

The order of `needs` is unchanged: most blocking first, then oldest.

## 12. Bead detail

`GET /api/beads/{id}`, authenticated. The backend runs `POSTERN_BEAD_CMD` (on the
factory's host, `mw postern bead`) with the id appended and answers its output:

- `200 text/plain` — the same encoding as §11's view, of the JSON below;
- `400` — an id that is not `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`;
- `404` — the command exited 3 (no such bead);
- `501` — no `POSTERN_BEAD_CMD` is configured;
- `502` — anything else, or no answer within 25 seconds.

```json
{
  "v": 2,
  "id": "mw-abc.3",
  "title": "Pick the storage engine",
  "type": "task",
  "status": "open",
  "priority": 1,
  "parent": "mw-abc",
  "labels": [],
  "assignee": "",
  "waits": ["mw-abc.2"],
  "blocks": ["mw-abc.4"],
  "children": [],
  "created": "…", "updated": "…", "started": "", "closed": "",
  "path": { "rig": "postern", "branch": "main", "host": "desktop", "model": "sonnet", "effort": "high", "formula": "tdd-feature", "harness": "claude" },
  "attempts": 0,
  "description": "<markdown>",
  "acceptance": "<markdown>",
  "comments": [{ "at": "…", "author": "root", "text": "<markdown>" }]
}
```

`comments` are every comment, oldest first, each cut at 16000 runes with a marker.

## 13. The Governor's actions

Decision 7: a tap that needs no thinking goes straight to beads as the Governor,
and the Mayor is told afterwards. An action is an ordinary message (§1, class
`message`, Governor to Mayor, delivered by §9) whose plaintext is:

```json
{ "action": "release", "bead": "mw-abc" }
```

| `action` | extra field | what the Mayor's host does, at zero tokens |
| --- | --- | --- |
| `release` | — | releases a held story, or every held story of an epic |
| `hold` | — | holds an open, unclaimed story |
| `priority` | `"priority": 0..4` | sets the bead's priority |
| `verified` | — | comments `VERIFIED by the Governor via postern (<txid>)` on the story |
| `run` | `step`, `sha256`, `approved_at`, `sig` | runs a hands step he approved (§17) |
| `keep` | `"days": n` (default 30) | keeps a stale bead (§11) for `days` more days, so it is not raised as `stale` again until they pass |
| `close` | — | closes the bead; on an epic or a map it closes the held (`deferred`) children first, then the epic |

```json
{ "action": "keep", "bead": "mw-abc.3", "days": 30 }
{ "action": "close", "bead": "mw-abc" }
```

`close` refuses a bead that has an `in_progress` child: nothing is closed, and the
host says so as text (a message to the Mayor naming the bead and the child) rather
than as a comment on the bead.

An answer to a question stays §6's reply, and a comment on a bead stays §6's
threaded message with a bead thread; all three kinds are applied the moment they
arrive (the backend's on-message hook runs `mw postern inbox --apply`), each at
most once per txid, only when the verified sender is the Governor. Each applied
action is commented on its bead (`RELEASED by the Governor via postern, txid …`)
and mailed to the Mayor. An action the host does not know is left for the Mayor
to read as text.

## 14. Voice notes, files and transcripts

§8's attachment `mime` widens to `image/png`, `image/jpeg`, `image/webp`,
`audio/webm`, `audio/ogg`, `audio/mp4`, `audio/mpeg`, `application/pdf` and
`text/plain`; the 8 MiB cap is unchanged (about half an hour of Opus voice).
Attachments now travel both ways: the Mayor may attach a file to a message to the
Governor exactly as the app does (`mw postern send --attach <file>`). From the
app, several files are one message's `attachments` (§8); `mw postern send
--attach` still sends one message per file, the caption on the last. Both are
valid for a reader.

§6's threaded body gains two optional fields:

```json
{ "thread": { "bead": "mw-abc.3" }, "text": "<transcript>", "re": "direct:…", "role": "transcript" }
```

- `re` — the txid of the message this one answers or annotates;
- `role` — `"transcript"` marks the text as what the Mayor's host heard in the
  voice note `re` names.

**Replies in every channel.** A message, whether plain text or carrying files
(`attachment` or `attachments`, §8) with or without a caption, whose `re` names another
message *in the same channel* (General, a bead's thread or a named topic) is a
*reply* in that message's thread. The thread's root is the named message, or, if
that message is itself a reply, its own root: threads are one level deep, however
long the chain of `re` runs. Roots and their replies are each read in time order,
and a thread knows its reply count and the time of its last reply. A message
whose `re` names a txid the reader does not hold in that channel stays a root. A
bead's own comment carries no txid, so it is always a post, never a reply. A
transcript (`role: "transcript"`) and a grist answer (§19, its own record kind)
are annotations, not replies, and keep their rendering. The app groups a
channel's conversation this way with `groupPosts` in `src/model/postThreads.ts`;
a thread opens at `?v=talk&t=<channel>&r=<root txid>`, and a push for a reply
opens that URL. A reply whose `re` names a post that lives in another channel
(one sent with no channel to a bead's or a named channel's post sits in General)
is still that post's reply: the app resolves the root across channels, the tap
and the Thread screen open the post in its own channel with the reply under it,
and only a root the phone does not hold keeps the reply a root of its own. A message that carries `re` is always sent as the
JSON `{ "text": …, "re": "direct:…" }` (§6), never as bare text. A picture can be a reply:
`{ "text": …, "attachment": {…}, "re": "direct:…" }` (or `attachments`) is a reply in
that post's thread exactly as a text reply is, and so is a voice note with `re`;
only `role: "transcript"` marks an annotation.

A voice note is a threaded message whose attachment is audio (its `text` may be
empty). The Mayor's host transcribes it on arrival (`postern_transcribe_cmd`,
decision 11: on the desktop, never a third party), records the transcript on the
bead as the Governor's words, and sends it back as a `role: "transcript"` message
in the same thread, so he sees exactly what was heard under the note he sent.

## 15. Who is who: `GET /api/me`

`GET /api/me`, authenticated, answers who the caller is and who the Mayor is:

```json
{ "pubkey": "<the caller's key>", "mayor": "<POSTERN_MAYOR_KEY, or empty>", "mill": "<POSTERN_MILL_KEY>", "network": "testnet", "features": ["direct", "events", "view", "beads", "me", "grist"] }
```

`mill` and the `grist` feature are absent from a cockpit key's answer (not empty)
unless the backend has a mill key (§19).

A cockpit key's answer also carries two fields that say what the backend
licenses, so the cockpit need not be told by hand:

```json
{ "collections": [{ "name": "postern" }, { "name": "spellforge-leaderboard-testnet" }, { "name": "cairn", "app": "cairn" }],
  "issuer": "<the testnet address of POSTERN_ISSUER_KEY>" }
```

`collections` has one entry per collection the backend knows: `POSTERN_COLLECTIONS`
first, each `{ "name" }`, then the collections of `POSTERN_APPS`, each
`{ "name", "app" }`, in the order configured. `issuer` is the testnet address of
`POSTERN_ISSUER_KEY`, and is absent (not empty) when that key is not set. An app's
key gets neither field.

An app's key (§19, *Who may do what*) gets a smaller answer: its own key, the
mill, the network, `"features": ["grist"]` and `"apps"`, the apps its licences name;
never the Mayor.

The app pins `mayor` the first time it sees it (trust on first use) and asks the
Governor before accepting a different one; it never needs the key pasted by hand
again. A `401` from this call means the key holds no licence (§16), which is how
the app decides to offer the licence screen: it no longer walks the chain itself
on every start.

## 16. The licence, v2

Decision 14: Postern is the Governor's alone, through a licence he issues. A key
holds a licence when the chain carries a type-M record for it that is:

- in one of the backend's collections (`POSTERN_COLLECTIONS`, default
  `postern,spellforge-leaderboard-testnet`: the second only until every licence is
  re-minted into Postern's own collection);
- **issued**: at least one input of the mint transaction is unlocked by the
  issuer's key (`POSTERN_ISSUER_KEY`: a P2PKH scriptSig whose public-key push is
  that key, spending an output P2PKH to hash160 of that key, so the network
  checked the signature; a pushed key over any other output proves nothing). A
  self-minted record by anyone else no longer counts; with no issuer
  configured the backend logs a warning and keeps the old rule;
- **not transferred away**: no later transaction spends the licence's token
  outpoint with a type-TR record naming someone else. A TR record's payload may be
  the library's `{"to": "<address>"}` or the older `{"origin", "to"}`; either way
  it is tied to the licence by the outpoint its transaction spends, never by the
  payload alone;
- **not revoked**: the issuer can end a licence without the holder's help. A typed
  **W** record whose payload is JSON `{"kind":"revoke","origin":"<txid>:<vout>"}`, in
  a transaction the issuer key signed (an input unlocked by `POSTERN_ISSUER_KEY`, as
  for a mint) and found in the **issuer's** address history, ends the licence whose
  mint output is `origin` (the token, output 0 of the mint): from that transaction on
  nobody holds the collection through that token, whatever later TR records do with
  it. The same record signed by any other key, in a transaction outside the issuer's
  history, a W record with any other payload, a revoke naming an origin that is not a
  counting mint, all change nothing. A revoke names one mint output, so a mint after
  it, even to the same key in the same collection, is a new licence. With no issuer
  configured a revoke record is never read.

A typed record (M, W or TR) is `OP_FALSE OP_RETURN 'nftgate' 0x02 <type>` and then one
of three layouts, all read alike, the payload always the last push: **6 pushes**, the
gated layout spell-forge writes since mw-jeswf.3 (a 32-byte epoch commitment, an empty
value manifest `0x00`, the payload; a 6-push record whose 4th push is not 32 bytes is
not a record); 5 pushes (the manifest, the payload: Postern's own records and
spell-forge-bsv 0.1.0's); 4 pushes (the payload alone, the oldest tokens). A gated M's
payload carries `wrapKey` and `wrap` besides `collection` and `holder`; the backend reads
only those two. What makes a spell-forge License token count for an app is
docs/licence-token.md.

## 17. Steps for his hands, approved and run from Postern

The Governor, 2026-09-28: "I should be able to approve and execute 'my hands' work from
postern." A step only his hands could take — a `sudo` line, a unit to enable, a
file to move between hosts — is written by the Mayor as a **hands step** on a
`hitl` bead, shown to him exactly as it will run, and run by the factory's host
only once he approves it with his key. Nothing else can run it: not the Mayor, not
the backend, not anyone holding the host's own account.

### The step

The Mayor adds a step with `mw hands add <bead> --id <id> --host <host> --as user|root
[--way-back '<commands>'] -- '<commands>'`. It is kept on the bead (a note, `hands.<bead>`,
holding every step of that bead) and commented there for the record. The view (§11)
carries a `hands` need's steps:

```json
{ "kind": "hands", "bead": "mw-f758y.8", "…": "…",
  "steps": [
    { "id": "linger", "host": "desktop", "as": "root",
      "run": "loginctl enable-linger jwhite", "way_back": "loginctl disable-linger jwhite",
      "sha256": "<hex of sha256(canonical)>",
      "ran": { "at": "2026-09-28T12:03:00Z", "exit": 0, "host": "desktop" } }
  ] }
```

`ran` is absent until the step has run. The **canonical bytes** of a step, what its
`sha256` is over and what his approval binds, are the UTF-8 of:

```
hands/v1\n
<len>:<bead>\n
<len>:<id>\n
<len>:<host>\n
<len>:<as>\n
<len>:<run>\n
<len>:<way_back>\n
```

where each `<len>` is the decimal byte length of the field that follows its colon.
The app recomputes the hash from the fields it shows and refuses to approve a step
whose text does not hash to the `sha256` it was given.

### The approval

Approving is a §13 action, delivered like any other:

```json
{ "action": "run", "bead": "mw-f758y.8", "step": "linger",
  "sha256": "<the step's sha256>", "approved_at": 1790000000, "sig": "<DER hex>" }
```

`sig` is his key's ECDSA signature over the SHA-256 of the UTF-8 string
`hands-approve/v1\n<sha256>\n<approved_at>\n` — the same signing the backend's
challenge uses (`@bsv/sdk` `PrivateKey.sign`, `docs/api.md`). The app asks for his
fingerprint again (a fresh passkey assertion) before it signs, however long ago the
day's unlock was.

### Running it

On the factory's host, `mw postern inbox --apply` takes a `run` action only from the
Governor, and only when the step on the bead still hashes to the approved `sha256`,
the approval is under 15 minutes old, and that approval has not run before. Then:

- `as: user` — runs as the host's own user, `sh -c`, with a 10-minute limit;
- `as: root` — hands the step and the approval to `mw-hands-root` through
  `sudo -n`. That small root-owned program (installed once, by his hands, with a
  sudoers line naming only it) checks the signature itself against his public key
  in `/etc/mw-hands/governor.pub`, that the step is for this host
  (`/etc/mw-hands/host`, so an approval cannot be replayed on another host), the
  hash, the age and that the approval is unused, and only then runs the step as
  root. The host's own account cannot run anything as root without his signature.
- a step for another host runs there over the `ssh` prefix `mw`'s config names for it
  (`[hands_hosts]`), the same checks and the same helper on the far side. A prefix
  must log in as a **non-root** user: over a root login a user step would be a root
  step no helper checked, so `mw` refuses it.

The backend's on-message hook allows 25 minutes a run, longer than `mw`'s 12-minute
lock wait plus a step's 10: a step is never killed after its approval is spent.

### Nothing else his key signs can be an approval

His key also signs the backend's login challenge (`docs/api.md`). The app signs a
challenge only when it is plain lowercase hex (what the backend issues), so a
backend can never get `hands-approve/v1\n…` signed in its place without him.

### Fingerprints

Wherever a key must be checked by eye — the installer before it trusts his key, the
Me screen, a changed Mayor key — it is shown as the first 16 hex digits of the
SHA-256 of the key's hex text, in groups of four (`15f6 7a1c 42f4 8fe6`).

A step waits on its bead's blockers. While any bead the `hands` bead waits on (§11's `waits`)
is still open, the need is `not_ready` and `waits_for` is `factory`, and `waiting_on` names the
open blockers by title; the app shows `Waits on: <title>` and offers no Approve. `mw` enforces
the same rule when a `run` action arrives, however it got there: a step whose bead waits on an
open bead is not run, and the answer is `NOT RUN step <id> on <bead>: waits on <title>`. This
holds for a tap made before the blocker was added and for one that arrives late.

The outcome — exit code and the last 4000 characters of output — is commented on
the bead (`RAN step <id> on <host> as <as>, exit <n> …`), sent back to him in the
bead's thread, and mailed to the Mayor. A refused approval is answered the same
way with why.

## 18. Moving the factory's home

Only the Governor starts a move of the factory's home between the desktop and the
laptop (never the VPS), in one tap: the Me screen's Home row has "Move home to
desktop" and "Move home to laptop" (the current home's button disabled), and after
one confirm ("Move the factory's home to <host>? The Mayor there takes over.") the
app sends a message of class `move-home` to the Mayor, delivered by §9 like any
other. Its plaintext is:

```json
{ "host": "laptop" }
```

`host` is `desktop` or `laptop`. The class rides in the clear (§1) so the host that
applies it needs no more than the envelope to know what it is. When every `/api`
call answers `503` with `"standby": true` (`docs/api.md`'s Standby: the host that
answered is not home), the app says "Home is down" on every screen and offers the
same button for the other host; the send still works because a standby host serves
the routes a send needs.

## 19. Grist: an app's AI work for the factory

The Governor, 2026-09-29 (vault `plans/0024-grist-plan.md`): an app sends the factory
some AI work, a photo or some data, and gets an answer back later, while the app
carries on. The first is Cairn's photo Sweep: a photo of a drawer comes back as the
items in it. **Grist** is that work; a **grind** is an app's standing instructions for
one kind of it (what it accepts, the model, the instructions, the answer's schema).
Grist rides this backend exactly as a message does (§8, §9), through the same
licence gate (§16): the "Postern method", for every app.

### The mill

The factory's side is the **mill**: `mw grist grind` on the factory's home host,
holding the **mill key**, a key of its own (never the Mayor's), named to the backend
as `POSTERN_MILL_KEY`. The mill key needs no licence: the backend's own configuration
vouches for it. `GET /api/me` names it (§15), so an app pins it the way Postern pins
the Mayor: trust on first use, the fingerprint shown on its key screen.

### Who may do what

A licence's collection (§16) now says which door it opens:

| The key | Holds | May |
| --- | --- | --- |
| A **cockpit** key | a licence in one of `POSTERN_COLLECTIONS` (today `postern`) | everything, as before §19 |
| The **mill** key | `POSTERN_MILL_KEY` | read its own records; post `grist` to any key; fetch blobs; delete a blob whose uploader has sent a grist to the mill; `GET /api/me` |
| An **app** key | a licence only in an app's collection (`POSTERN_APPS`, e.g. `cairn=cairn`) | read its own records; post `grist` to the mill only; upload blobs; subscribe its own pushes; `GET /api/me` |

Anything else an app or the mill key asks for is `403`. "Its own records" means
`GET /api/messages` returns only records whose `to` or `from` is the caller: an app
never sees who else talks to the factory. A key that holds both kinds of licence is
a cockpit key. The mill key is never a cockpit key: it gets the mill's rights whatever
it holds on the chain, and the backend logs one line at start if it also holds a
cockpit licence.

`POSTERN_APPS` maps each app's collection to the app's name, `collection=app`
comma-separated: `cairn=cairn`. A collection is either a cockpit collection or an
app's, never both; so before spell-forge's own licences can send grist,
`spellforge-leaderboard-testnet` leaves `POSTERN_COLLECTIONS` (the move §16 already
anticipates). The issuer rule (§16) applies to app
collections exactly as to Postern's own: only a mint the Governor's issuer key signed
counts, and a transfer away revokes it. The Me screen's "Issue a licence" is not built
yet; it will issue one to a key an app shows him as a QR code.
Ending one is the Key screen's **Revoke**: it writes the §16 revoke record (a W record
`{"kind":"revoke","origin":"<txid>:<vout>"}` naming the licence's mint output, in a
transaction the issuer key signs), and the licence stops opening its door for that key
once the backend next walks the chain (§16, "not revoked").

### The grist record

A grist is §1's envelope with `"class": "grist"`, `to` the mill key and `from` the
app's key, delivered with `POST /api/messages` (§9). Its plaintext, what `ct` seals
to the mill key:

```json
{
  "grist": { "app": "cairn", "kind": "sweep", "v": "1.1" },
  "input": { "schemaVersion": "1.1", "requestType": "sweep", "place": { "name": "Top drawer", "path": "Kitchen -> Top drawer" } },
  "attachments": [ { "hash": "<sha256 hex>", "size": 412345, "mime": "image/jpeg" } ]
}
```

- `grist` — which grind to run: the app (it must be one the sender's licences name),
  the kind, and the version of the app's own request schema.
  The header may also carry two optional fields, `"model"` (a model name: `"haiku"`,
  `"sonnet"`, `"opus"`) and `"effort"` (one of `"low"`, `"medium"`, `"high"`, `"xhigh"`,
  `"max"`), as in `{ "app": "cairn", "kind": "sweep", "v": "1.1", "model": "sonnet",
  "effort": "high" }`. Absent means the grind file's own values, as before. The mill
  runs the asked values only within the factory's caps (`[grist] models`, and
  `[grist] efforts`, default `low,medium,high`); a value outside them refuses the grist
  with reason `model` or `effort`, naming the value. The backend never reads either
  field: the plaintext is sealed to the mill key. An app should offer its user only
  values he may choose.
- `input` — the app's request, in the app's own schema (here Cairn's Sweep Request).
  The mill hands it to the grind as data, never as instructions.
- `attachments` — optional, at most 4. Each is uploaded first with `POST /api/blobs`
  (§8), sealed to the **mill** key exactly as §8 seals an image to the Mayor's.
  `mime` is one of `image/jpeg`, `image/png`, `image/webp`. A grind may set tighter
  limits.

The backend stamps each directly delivered record with `signer_apps`: the apps whose
collections the signer's licences name, as it knew them when the record arrived. The
mill trusts that stamp, not the plaintext, to decide whether a key may use an app's
grinds.

### The answer

The mill answers every grist exactly once, with a `grist` record from the mill key
to the grist's sender. Its plaintext:

```json
{
  "re": "direct:<the grist's txid>",
  "status": "answered",
  "answer": { "schemaVersion": "1.1", "responseType": "sweep-result", "placeName": "Top drawer", "items": [ { "name": "scissors" } ] },
  "grind": { "app": "cairn", "kind": "sweep", "v": "1.1", "commit": "<the app rig's commit the grind was read at>" }
}
```

- `re` — the grist's `txid` (`direct:…`), which is how the app matches an answer to
  the photo it sent.
- `status`:
  - `answered`: `answer` holds the grind's answer, in the app's own schema, already
    checked against it by the mill. The app checks it again before it keeps anything.
  - `refused`: the mill will not grind this grist. `reason` says why: an unknown grind,
    an app the sender holds no licence for, too many or too large attachments, the
    sender's daily limit, or the model declining. Sending the same grist again gets
    the same answer.
  - `failed`: the grind could not finish (a session died, the answer would not fit its
    schema). `reason` says what happened; the app may send it again.
- `reason` — present unless `answered`: one plain sentence, fit to show the person.
- `grind` — which grind answered, and the commit of the app's rig it was read at.

After answering, the mill deletes the grist's attachments (`DELETE /api/blobs/{hash}`,
`docs/api.md`) rather than leaving them for §8's 30 days. Nothing else keeps the photo:
the mill opens it in a private directory and removes it when the grind ends.

### Waiting

A grist waits at the backend until the mill takes it. The mill runs only on the
factory's home host, and each grind occupies one of that host's story slots, first
come first served. So a grist can wait minutes while the factory is busy, or hours
while its host is off. Nothing is lost by waiting: the app shows the grist as *at the
factory* and pages `GET /api/messages?since=` (every 20 seconds while any grist is
unanswered, and when it opens) until its answer arrives.

### The on-grist hook

`POSTERN_ON_GRIST` is a shell command run after a grist addressed to the mill is
indexed: on the factory's host, `mw grist grind`. It is debounced, never overlaps,
and runs once more if a grist arrived mid-run, like `POSTERN_ON_MESSAGE` (§9). The
on-message hook is not run for a grist to the mill, so a batch of photos never delays
one of the Governor's taps. Grist also keeps until the mill's next pass, so a missed
hook only delays an answer.

### Reaching the backend from another origin

An app served from its own origin (Cairn is on GitHub Pages) calls the backend
cross-origin. `POSTERN_CORS_ORIGINS` lists the origins allowed to (for example
`https://jonathan-a-white.github.io`): for those, every response carries
`Access-Control-Allow-Origin` with that origin, and an `OPTIONS` preflight is answered
`204` allowing `Authorization` and `Content-Type` on `GET`, `POST` and `DELETE`. Any
other origin gets no CORS headers, so browsers refuse it.

### Test vectors

`docs/fixtures/grist-vectors.json` holds a grist plaintext, one whose header asks for a model and an effort
(`gristAskingModelAndEffort`), its answer in each
status, and envelopes the backend must accept or refuse for each kind of key. The
backend's tests and the mill's read the same file.

## 20. Talk

The Governor, 2026-10-01 (map `mw-j0f2d`): he holds a button in Postern, speaks, and
hears and sees the Mayor's short answer within about 8 seconds. Each spoken turn,
and each answer, is a **turn**: §1's envelope with `"class": "talk"`, delivered with
`POST /api/messages` (§9). The Governor's turns go `to` the Mayor's key, the Mayor's
answers `to` the Governor's.

### What the backend does with a turn

A `talk` record reaches §10's event stream, and no on-message or on-grist hook runs for
it. It carries no `summary` (§1), so no word of either side is ever pushed, handed to a
hook or logged; the clear class tells the backend a turn's time and size, never its words.

The one talk record that is pushed is the Mayor's **answer**: a turn whose `from` is the
Mayor's key (`POSTERN_MAYOR_KEY`) and whose `to` is anyone else. Its push is `{class: "talk",
txid, ts}` with **no words in it**, no title and no body: the answer's text, its talk `id` and its
`turn` are sealed in `ct`, and the push says only that the Mayor answered. The Governor's own
turns (to the Mayor's key), and every talk record when no Mayor key is configured, are never
pushed. A holding turn is an answer for this rule: the backend cannot tell them apart in the clear.

### An answer that comes while he has left the app

Android suspends the voice of an app that is in the background, and freezes a hidden page
outright, so a page cannot be counted on to hear the answer at all. The backend therefore pushes the
Mayor's answer, with no words in the push (above, mw-j0f2d.38), and the service worker shows
a notification titled "The Mayor answered" unless a focused window already shows the app; a tap
opens the Talk line, where the answer speaks. A page that is still alive does what it can itself
too (mw-j0f2d.29). While a talk is open
the page holds the screen awake and loops a silent audio element, to try to keep the
voice alive with the screen off. An answer the page reads while it is hidden is not
spoken: the page shows a notification titled "The Mayor answered", with the talk chime's
buzz and none of the answer's words, and keeps the answer unspoken. When the page is
visible again the answer is spoken at once and the notification is taken down. A page
the browser has frozen outright cannot show the notification; the answer then speaks on
return all the same.

The Mayor's host hears a turn by reading `GET /api/events` with the Mayor's key. That
key needs no licence for the stream: the backend's own configuration
(`POSTERN_MAYOR_KEY`) vouches for it, as it does the mill's key (§19), so a lapsed or
unreadable licence never cuts the Talk line. Without a licence it opens the stream
and nothing else (every other route is `403`); with a cockpit licence it is a cockpit
key as before. A stranger's key is still refused the stream (`401` without a licence,
`403` with only an app's).

### The turn plaintext

What `ct` seals to the recipient:

```json
{
  "talk": { "id": "<the talk's id>", "turn": 3 },
  "text": "What landed today?",
  "role": "turn",
  "model": "sonnet",
  "cut": true
}
```

- `talk` — which talk this turn belongs to: `id`, one talk from its first turn to its
  end, and `turn`, the turn's number within it. An answer carries the `id` and `turn`
  of the Governor's turn it answers.
- `text` — the words, as spoken or to be spoken. A record's payload may not pass 10,240 bytes
  (spell-forge-bsv's `encodeRecordScript`), so the Governor's turn carries at most 7,000
  bytes of text (as JSON writes it; about 1,100 words): a longer turn is cut at that and
  ends with `...`, and is still sent.
- `role`:
  - `turn`: the Governor's spoken turn.
  - `answer`: the Mayor's answer to it.
  - `holding`: a short answer the Mayor sends while the real one is still coming; the
    `answer` follows with the same `talk`.
  - `end`: the talk is over (either side may send it).
- `model` — optional: the model the Mayor's answers should use from this turn on (for
  example `"sonnet"`), or the model that answered. Absent means unchanged.
- `cut` — optional: `true` on a turn whose previous answer the Governor cut off with a
  tap before it finished speaking. Absent means `false`.
- `links` — optional, on an `answer` or `holding` turn: an array of bead ids (for example
  `["mw-j0f2d.36"]`), written by `mw talk say --link`. The Talk screen shows each id as a
  tappable chip under the answer; a tap opens that bead's page. The ids are never spoken
  (the voice drops bead ids before speaking). Empty entries and non-strings are
  dropped; absent means no chips.

### What a talk is about

A talk opened from a card, a hands step, a thread or a Prompts row carries an optional
`about` on its **first** turn (`turn` 1) so the Mayor hears what the talk concerns:

```json
"about": { "kind": "prompt", "id": "top5", "title": "/top5" }
```

- `kind` — `bead` (a card or a hands step: `id` is the bead's id), `channel` (a thread:
  `id` is the channel, such as `topic:garden`) or `prompt` (a Prompts row: `id` is the
  prompt's name, §23).
- `id` and `title` — both required; `title` is what the screen showed (the card's title, the
  channel's name, `/top5`). A turn whose `about` lacks a key or has another `kind` is read
  as having none.
- Later turns of the same talk carry no `about`. He can clear it before speaking; a talk
  without one is as before. `mw talk wait` prints it as `about: bead mw-xxx <title>`.

### Presence: is the Mayor here

The Governor, 2026-10-01: he wants to see, very subtly, when the Mayor is there and
when he is not, and to be told when the Mayor is back after a turn went unanswered.

The Mayor is **here** while his key (`POSTERN_MAYOR_KEY`) holds `GET /api/events` open,
which is what `mw talk wait` does for as long as it waits, **and for 120 seconds after the
last such stream closed** (the backend's `PRESENCE_GRACE`, one named constant). The grace is
there because his wait ends on every turn (when it brings him a message, and he answers) and
is armed again a moment later: the gap between two waits is not him going away, and without
the grace the mark would flicker to away on each turn. A stream opened again inside the grace
counts at once, and the grace runs from the close of the *last* open stream. He is **away**
once 120 seconds have passed with no stream open: a handoff, his host off, or no Mayor key
configured. The backend counts open streams by key, and remembers when each key's last one
closed, and nothing else; it reads no record and learns no word of any talk.

`GET /api/presence` (a cockpit key; `docs/api.md`) answers `{"mayor": true}` while he is
here and `{"mayor": false}` when he is away. The Talk screen asks it every few seconds while
it is open.

What the Talk screen does with it:

- A small dot beside the screen's status says **Mayor here** (a coloured dot) or **Mayor
  away** (a grey one). Until the first answer, and when the backend cannot be asked or has
  no such route (an older backend), it shows no dot rather than a guess.
- When the line has given up waiting (`The Mayor has not answered yet. If it lands, it will play.`) and the mark then
  turns from away to here, the phone buzzes (and chimes where it can) once: the Mayor is back
  and the turn can be tried again. Turning to here at any other time is silent.
- The give-up is only the line's wait window (60 s with the Mayor away, 90 s with him here); it never
  drops an answer. An answer that lands after it is played when the line is free, or shown under the
  turn it answers, marked *Not heard yet*, when he has already gone on to a newer turn; the turn then
  reads `answer took N s` in place of `first words in N s` (mw-am3yjh.5).

## 21. Call

The Governor, 2026-10-01 (map `mw-a0ih0`): the Talk line answers within seconds when
the Mayor is here, but the Mayor is sometimes away between waits. A **call** is the
note he leaves then, and the Mayor's way of calling back. A call record is §1's
envelope with `"class": "call"`, delivered with `POST /api/messages` (§9): his go `to`
the Mayor's key, the Mayor's `to` his. His request and his later carry no `summary`, so no
word of them is ever pushed, handed to a hook or logged; the Mayor's ring carries its reason
as the clear `summary` of a direct record, and that is the only word of a call that is
pushed (below).

### What the backend does with a call record

The same as with a Talk turn (§20) for every call record but a ring: it reaches §10's event
stream (a `message` event) and nothing else, and runs no hook. The role is in the sealed
plaintext, so the backend knows it only from a **clear `role`** the sender may put in the
envelope beside `class` and `ct` (`"role": "ring"`, `"request"` or `"later"`); a call
record with no clear role, or any role but `ring`, is never pushed, handed to a hook or
logged.

- A **request** needs no push: the Mayor's `mw talk wait` is a reader of §10's stream and
  prints it the moment it is indexed.
- A **ring** is pushed to his phone. The backend does it when the record's clear `role` is
  `ring` and `to` is a key with a subscription: the push is the §9 item 6 push, with
  `class` `call`, the record's `txid` and `ts`, the title `The Mayor is calling` and, for a
  direct record, the ring's reason as the body. The reason rides as the record's clear
  `summary` (§1: at most 80 runes, the same rule as a decision's), so it is public to anyone
  who reads a direct record in transit, and **a ring sent on chain carries no reason in its
  push**: the title alone rings, and the reason shows once the phone has decrypted the
  record. The ring still runs no hook. A ring that is never pushed (the backend in
  standby, no subscription) is still read on the Talk line.

### How the phone rings

A ring's push is not an ordinary notification (src/push/classOptions.ts): its tag is
`mayor-call` (a second ring replaces the first and re-alerts), it stays until he deals with
it (`requireInteraction`), it is never `silent`, and it carries two buttons, **Answer** and
**Later**, and a long vibration pattern, ten pulses of 600 ms 400 ms apart. The app sets no
volume and never reads the phone's ring mode: Android plays the sound, the vibration or
nothing as the phone's ring, vibrate or silent mode says. A Web Notification cannot loop
forever, so the pattern plays once per ring; a second `mayor-call` push rings again.

- **Answer**, or a tap on the notification itself, opens `/?v=line&call=<txid>`: the Talk
  line, which reads **The Mayor called HH:MM: <reason>** above the hold button.
- **Later** sends the `later` record below, through an open window of the app (the key is in
  the app, never in the service worker), or, with no window open, keeps the tap in IndexedDB
  and sends it at the next unlocked open. It closes the notification and opens nothing.

### The call plaintext

What `ct` seals to the recipient is one JSON object, told apart by `role`:

```json
{ "role": "request", "text": "Call me", "at": 1790000000 }
```

```json
{ "role": "ring", "text": "Back now: two landings.", "at": 1790000090 }
```

```json
{ "role": "later", "ring_txid": "direct:<sha256 hex>" }
```

- `request` — his **Call me**: `text` is what he typed (the Postern screen prefills
  `Call me`) and `at` the Unix seconds he sent it. The Mayor's host answers a request by
  ringing, or by answering on the Talk line.
- `ring` — the Mayor's call-back: `text` is a short line to show with the ring, `at` the
  Unix seconds he sent it.
- `later` — his **Later** tap on a ring: `ring_txid` is the `txid` (§9) of the `ring`
  record he is putting off.

`text` of a `request` is cut, as a turn's is (§20), so the record stays under 10,240
bytes: at most 2,000 bytes of text as JSON writes it, ending `...`.

### What the Talk screen shows

After he sends a request the Talk line screen reads **Call sent HH:MM** (the phone's
24-hour local time of `at`) under the presence mark, until a ring from the Mayor or an
answer on the Talk line arrives after it; then the note goes.

The Mayor's newest ring leaves a note above the hold button, with the ring's `at` as
HH:MM and its `text`: **The Mayor called HH:MM: <text>** once he opened the line from that
ring's Answer, **Missed call HH:MM: <text>** for any ring he did not answer (Later, a
swipe, a locked phone). The note stays until a turn he sends at or after the ring's `at`.

### When the backend cannot be reached

A Call me, and every typed post, must still leave when the direct line is down. For a text
post of any class (a Call me, a message, an answer, an action, a Talk turn), the phone puts the
record on chain itself. **A post that carries a picture or any other file is not put on
chain**: the file goes up through the backend (§8), so the post waits in the phone's outbox
and goes the usual way once the backend answers:

- **When.** The live status is `offline` (the phone already knows; it then skips the direct
  post), or the `POST /api/messages` of §9 fails as a network failure: no connection, no
  answer within the API timeout, no sign-in code from `GET /api/challenge`, or a 502, 503
  or 504 from the gateway in front of the backend. A 404 or 405 (a backend without direct
  delivery) keeps today's rule for every class: the funded transaction goes through the
  backend's own `/api/utxos` and `/api/broadcast`. A refusal in the backend's own words (any
  other 4xx) is final for every class and is not retried on chain. A post with a file waits
  in the outbox on a network failure and is tried again.
- **How.** The same §4 transaction to the same §3 anchor address: output 0 the record,
  output 1 the 1-sat anchor payment, output 2 change. Its coins come from WhatsOnChain's
  `GET <provider>/address/<address>/unspent` (a bare list of `tx_hash`, `tx_pos`, `value`,
  `height`; a 404 is no coins) and it is broadcast with `POST <provider>/tx/raw`
  `{ "txhex": "<hex>" }`, which answers the txid. `<provider>` is the chain provider of the
  rig's chain switch (`chainConfig.providerBaseUrl`: WhatsOnChain's testnet today), the
  same chain the backend's poller reads. The phone's pending-spend memory still applies,
  so two calls in a row do not spend one coin twice.
- **Why the Mayor still hears.** The backend's poller reads the anchor address from
  WhatsOnChain every 5 seconds, so a record the phone broadcast reaches `GET /api/messages`
  and §10's stream with no backend change, and the Mayor's `mw talk wait` prints it within
  a minute once the backend is back.
- **What it costs.** One small transaction: the miner fee at `chainConfig.feeRateSatPerKb`
  (a few satoshis for a record this size) plus the 1-sat anchor payment, from his own
  coins. Testnet today. A post sent on chain is final: it cannot be taken back.
- **What he sees.** A typed post's bubble reads **Sent on chain HH:MM** in place of its plain
  time, because its sent copy is kept under a transaction id and not a `direct:` id. The Talk line screen reads **Sent on chain HH:MM, txid <first 8 hex>…**
  in place of **Call sent HH:MM**, until a ring or an answer arrives; the connection mark
  keeps saying the backend is reconnecting. The sent copy is kept under the transaction id,
  not a `direct:` id, and the backend's later echo of the same record lands on that row.

### The phone reads the chain itself

The Mayor can answer a Call me, or ring, while the phone cannot reach the backend (the
backend's push, §21's ring, needs the backend too). So while the live status (§10) is
`reconnecting` or `offline`, the phone reads the anchor address (§3) from WhatsOnChain
itself, with no backend:

- **When.** Every 5 seconds, the first read 5 seconds after the status first reads
  `reconnecting` or `offline` (a drop that mends in a moment never asks WhatsOnChain). It
  stops the moment the event stream is back (status `live`), and starts again at the next
  drop. A read that fails (WhatsOnChain out of reach too, or answering 429 or an error),
  that could not fetch a transaction, or that found no new record (a message or an events
  batch) doubles the wait before the next, 5 seconds to a cap of 60; a clean read that
  found a record brings it back to 5. While the page is hidden (`document.hidden`) no read
  is made, and the wait stays as it was.
- **What it reads.** `GET <provider>/address/<anchor>/unconfirmed/history` and
  `GET <provider>/address/<anchor>/confirmed/history` (`{ "result": [{ "tx_hash", "height" }] }`;
  a bare list is read too; a 404 on the confirmed history is none), at the same `<provider>` as
  the rest of §21. Only the newest page is read: a ring is recent. Each transaction not yet
  read this session is fetched with `GET <provider>/tx/<txid>/hex`, at most 10 a read, 500
  milliseconds apart (about 2 a second, inside WhatsOnChain's free tier), newest first, the
  rest on later reads; a 429 ends the read there. A transaction counts as read only once its
  records are applied (or none is his): one whose fetch failed is asked for again at the next
  read, and costs the others of that read nothing. A transaction is read once, so the 1-sat anchor payments and
  the records for other keys cost one fetch each, not one per tick.
- **What it keeps.** Each output that is a §1 record (§4's script, version `1`) whose `to`
  or `from` is his key goes through the same decrypt (§2) and the same store as a record from
  `GET /api/messages`, under `txid:vout`. A record already on the phone, from the backend or an
  earlier read, is left as it is and counts as nothing new; the backend's own sync, once it is
  back, replaces a record kept here by its own copy of the same `txid:vout`, so nothing shows
  twice. Its sequence number is unknown until then.
- **A ring rings.** A new `call` record from the Mayor whose plaintext role is `ring` (§21's
  plaintext) and whose `at` is within the last 10 minutes rings in the app: if notifications are
  allowed and the app's service worker is registered, the ring notification of "How the phone
  rings" (Answer, Later, the long vibration, tag `mayor-call`), its body the ring's `text`, which
  the phone has just decrypted; otherwise a banner over the screen, **The Mayor is calling**,
  with the reason, **Answer** (opens the Talk line on that ring, as the notification's Answer
  does) and **Dismiss**, and the same vibration pattern played once. An older ring is kept and
  does not ring: it reads **Missed call HH:MM: <reason>** on the Talk line, as any unanswered ring.
- **The line reopens.** Any record newly kept from the chain cuts the stream's reconnect wait
  short, so the phone tries the backend at once (§10's stream, and the sync after it) rather
  than at the end of its backoff. If it connects, the status goes `live` and the chain read stops.

## 22. Events

The Governor, 2026-10-01 (map `mw-6ww.55`, Q2 B and Q3 B): the factory's events (a
bead changing state, a landing, an alarm) reach Postern as one sealed record per batch
of about 2 seconds, not one per event, and an emergency goes out unbatched. A batch is
§1's envelope with `"class": "events"`, sent from the Mayor's key (the home) `to` the
Governor's, delivered with `POST /api/messages` (§9) or put on chain (§4). It carries
no `summary`, so no word of it is ever pushed, handed to a hook or logged. An emergency
is pushed all the same, as a bare alarm with no word of it (below).

### What the backend does with an events record

The same as with a Talk turn (§20) and a call record (§21), and for the same reason:
an `events` record is indexed like any record, gets a `message` event on §10's stream
(the one `seq` the client pages from) and **nothing else**: no on-message hook, and no web
push **unless it is an emergency**. The Governor's phone reads batches off the stream when
it is open; an ordinary batch is never a reason to wake it.

- **The class rule.** An `events` record is pushed when, and only when, its clear `lane`
  (§1) is `"emergency"`; `normal`, `fallback`, no lane or any other value is not pushed.
  An emergency push is `{class: "events", txid, ts, title: "Emergency"}`: its title is the
  lane's name and it carries no body, because the detail is sealed in the record (a
  `summary` on an events record is never a push body). The phone shows it as a notification
  that stays until dealt with, tagged so a second emergency replaces the first.

- **Direct.** `POST /api/messages` accepts the class from any cockpit key, as for any
  record (§9): `from` must be the key that signed the request, which is the Mayor's
  key when the Mayor posts it. The record is named `direct:<sha256 hex>` (§9).
- **On chain.** The poller indexes the same record when it finds it at the anchor
  address (§3, §4), once however often it sees the transaction: the index dedupes by
  `txid`.

### The events plaintext

What `ct` seals to the recipient:

```json
{
  "from": 4101,
  "to": 4101,
  "lane": "normal",
  "events": [
    {
      "seq": 4101,
      "ts": 1790000000,
      "kind": "bead.state",
      "bead": "mw-jrx0s.3",
      "actor": "builder",
      "from": "open",
      "to": "in_progress",
      "detail": "claimed"
    }
  ]
}
```

The field names are those of millwright's `domain/events` `Batch` (millwright's
`docs/events.md` did not exist when this section was written, so the story's names
are used; if that document differs, it wins and this section follows it).

- `from`, `to` — the first and last event `seq` in the batch, inclusive. They name the
  batch's **seq range**.
- `lane` — one of:
  - `normal`: the ordinary batch, about 2 seconds of events, sent direct.
  - `emergency`: an unbatched record for one event (or the few that cannot wait),
    sent at once, outside the batching window.
  - `fallback`: a batch re-sent on chain later, with the same seq range and events
    as the record it repeats, because the direct line could not be reached.
- `events` — the batch, in `seq` order; each is `{seq, ts, kind, bead, actor, from, to,
  detail}`: `seq` the event's number in the factory's own event log, `ts` Unix
  seconds, `kind` what happened, `bead` the bead concerned (or empty), `actor` who
  or what did it, `from` and `to` the state or value it moved between (empty when
  none) and `detail` a short free string. An event's `from` and `to` are the
  event's own, not the batch's.

A record's payload may not pass 10,240 bytes (as for a talk turn, §20), so a batch is
cut to fit and the rest follows in the next batch.

### Deduping: by seq, never by txid

A `fallback` batch repeats a batch already sent, and that batch may also have arrived
direct. The two copies are two index rows: a direct record's `txid` is
`direct:<sha256>`, a chain copy's is the transaction id, and the backend's index dedupes
by `txid` only. So the **reader** dedupes, by event `seq`: an event whose `seq` it
already holds is dropped, whichever record, lane or `txid` it came in. The same chain
transaction seen again by the poller is the same row and is never indexed twice. A
reader also tolerates a gap or overlap between batches: the seq range says what a
record claims to cover, and the event `seq`s are what is kept.

### What the app does with a batch

`mw-jrx0s.7`. The app reads an `events` record only from the pinned Mayor (§15) to its own
key, and never keeps it as a message. It keeps each event once by `seq` (Dexie `events`),
and applies those past its cursor (the last applied `seq`, in settings) to its own copy of
the view (§11), in `seq` order, keeping that copy's `written_at`: a bead's status, times and
comment count, a card asked, answered (`answered: {option, at}` on the need, this phone's
own field) or applied, a closed bead's cards settled and the cards that waited on it freed.
A changed field or a `hands_ran` fetches that bead's detail (§12) for the value the event
does not carry. It fetches the view again only on a gap (the first event past the cursor is
not cursor + 1), with no view yet, or when an event says something only the home can build
(a new or reopened bead, a hold, a landing, a story closed, a question it does not hold).
Once a batch has been applied in the session, §10's `view` event waits 10 seconds and
fetches the view only if no batch came within 10 seconds of it.

`mw-jrx0s.8`. The bead's page hears the events about its bead: a `message` shows in its
thread from the stored record (the sync keeps it before the batch is applied), so it fetches
nothing; a `bead_changed` whose detail is `comment` is the one thing only the bead's detail
(§12) holds, so the open page fetches that detail again, in place; a status or time the view
heard (above) shows on the page at once, the view's copy being the newer when its `updated`
is later than the fetched detail's. A card answered or a step run shows from the view and the
detail the sync already applied. The Talk line needs no event of its own: a turn is a stored
record (§20) that the line reads from the same store, whichever road brought it.

### The emergency lane in the app

`mw-jrx0s.13`. A batch whose `lane` is `emergency` is taken ahead of every other batch the
sync holds: its events are kept by `seq`, applied to the stored view and heard by the screens
**before** the ordinary batches, even out of `seq` order (a gap before it does not hold it
back). The seqs it applied past the cursor are remembered (a setting), so the ordinary pass,
which still moves the cursor over them, does not apply them a second time, and each event
is still kept once by `seq`.

A banner mounted in the shell, so on every screen, shows the newest emergency event's
`detail` above everything else until he taps it. It reads the stored events (so it appears the
moment the record is kept, and a reload does not lose it) and the newest emergency `seq` he has
tapped away (a setting, so a cleared one stays cleared). A tap clears it, closes the push's
notification if it is still up, and opens what the event is about: its `bead`'s page, or the
Talk line (§20) when it names no bead.

### The chain road, while the backend is out of reach

`mw-jrx0s.9`. The phone's own read of the chain (§21, "The phone reads the chain itself")
carries the factory's events too, so the queue keeps flowing with the backend down: the
Governor's words, 2026-10-01 (Q2 B on `mw-6ww.55`), the front end and the back end work on
their own queues and catch up once they can reach the chain.

- **Which records.** An `events` record (§1, class `events`) in a transaction the read has
  not seen, sent by the pinned Mayor (§15) `to` this phone's key, is decrypted (§2) and
  parsed as §22's plaintext. It is not kept as a message. Any other sender, or no Mayor
  pinned yet, and the record is ignored.
- **The same decoder.** The batch goes to the very projector the backend's feed uses ("What
  the app does with a batch"): kept once by `seq`, applied past the cursor in `seq` order to
  the stored view. A batch seen on both roads, the chain and the backend, therefore applies
  once, whichever arrives first and whatever its `txid` (`direct:<sha256>` or a transaction
  id).
- **A gap is tolerated.** A `direct`-lane batch is never on chain (only a `fallback` batch
  is, later), so the chain road shows gaps. The phone applies what it reads and does **not**
  fetch the view or a bead's detail for a gap, nor for an event that says something only the
  home can build: they all need the backend, which is out of reach, and a refetch
  attempted per batch would only be a storm of failures. The next successful sync after the
  backend returns (§10's `hello` fetches messages and the view) fills the gap in.
- **No hurry for the backend.** Events found on the chain alone do not cut the stream's
  reconnect wait short; a message or a ring does (§21).
- **When the backend returns.** The stream comes back (status `live`), the chain read stops
  at once, and the ordinary paging (`GET /api/messages?since=`, §10) resumes from the
  backend's own cursor. Its events records past the events cursor apply as usual; those
  the chain road already applied are dropped by `seq`.
- **What the screen says.** While the status is `reconnecting` or `offline` and a chain
  read has just succeeded, the connection badge reads **Live from the chain**, so he sees
  the app is current without the backend. A read that fails (WhatsOnChain unreachable too)
  puts the badge back to **Reconnecting…** or **Offline**.

## 23. Saved prompts

`mw-nqur1n` (stage 1). A saved prompt is a named piece of text with the options it takes.
The **backend is the definitive store**: one JSON file (`prompts.json`) under `POSTERN_DATA`,
so the app and the Mayor read the same list. The Mayor saves one with `mw prompt save`; the
app only reads them.

### The record

```json
{
  "name": "top5",
  "summary": "The five things that most want him",
  "signature": [
    { "flag": "--duration", "type": "duration", "default": "30m", "required": false, "help": "how far back to look" }
  ],
  "body": "List the five ...",
  "updatedAt": "2026-10-01T16:00:00Z",
  "updatedBy": "<the key that last wrote it>"
}
```

- `name` — 1 to 32 characters of `a-z`, `0-9` and `-`.
- `signature` — the options it takes (an empty array, never absent, when none). Each option has
  `flag` (begins `--`, no spaces, not given twice), `type` (`duration`, `string`, `int`, `bool` or `text`),
  an optional `default` (a string that parses as its type; empty means none; any string for
  `text`), `required` and `help`. The signature is what a call is checked against.
  A `text` option is the free-text option: a signature has at most one (a second is a `400`),
  and it takes every word of a call that no flag consumes, joined by single spaces.
- `body` — the prompt itself. `updatedAt` and `updatedBy` are stamped by the server on every
  write, whatever the request says.

### The routes

Contract in `docs/api.md` and `server/README.md`.

| Route | Does | Which keys |
|---|---|---|
| `GET /api/prompts` | every prompt, sorted by name, as an array | any licensed key, and the Mayor's key without a licence |
| `GET /api/prompts/{name}` | one prompt; `404` if none | the same |
| `PUT /api/prompts/{name}` | replaces the whole prompt of that name; `400` with a one-line reason for a bad name, flag, type or default, or a body naming another prompt; `413` over 256 KiB | cockpit keys only (the home's) |
| `DELETE /api/prompts/{name}` | `204`, or `404` if none | cockpit keys only |

`GET /api/prompts` carries an `ETag`; a request with a matching `If-None-Match` is `304` with
no body. The app keeps the last list and its ETag in its own store, so the Prompts screen
still shows with no network; a backend without the route (`501` or older) leaves what is kept.

### The call text

A call is an **ordinary message** (§1, class `message`) whose text begins `/`:

```
/<name> --flag value --other "a value with spaces" --switch
```

Words split on whitespace; single or double quotes keep a value whole. A `bool` option on its
own means `true` (`true` or `false` after it says so). When the prompt has a `text` option, the
words no flag consumes are its value (`/later a licence for Luke` gives `--text` the value
`a licence for Luke`); giving it both ways is `--text is given twice`, and leaving a required
one out is `/later needs some words`. A prompt with no `text` option refuses a stray word. The app checks it against the
signature before Send and refuses, with one inline line, an unknown prompt, an option the
prompt lacks, one given twice, a value that does not fit its type, a missing required
option or an unclosed quote. It fills no defaults: the text he typed is what goes out, and the
Mayor's side applies defaults (`mw prompt run <name> --flag value`). Text whose first character
is not `/` is never a call. `mw postern inbox` recognises a call, records it on the thread, and
tells the Mayor `Prompt: /top5 --duration 15m`; an unknown prompt is answered at once in the
thread.

### The Edit channel

Edit on a prompt opens the named channel `prompt:<name>` (for example `prompt:top5`), an
ordinary text conversation (§1) with the Mayor about that prompt; the screen shows the current
body. It changes nothing by itself: the Mayor saves the revised prompt with `PUT`.

## 24. Live cards

The Governor, 2026-10-01 (map `mw-6ww.56`, Q2 B and Q5 B): the Mayor's answer to a saved prompt
(§23) can be one card that is alive: a numbered list in which every item links to the beads
where he can go and do it, says what it waits for, and ticks itself off when that happens. The
same card is updated in place, so coming back a few minutes later he finds a link where there
was none. Two classes carry it, each §1's envelope from the Mayor's key `to` the Governor's,
sealed as any message is, delivered by `POST /api/messages` (§9) or put on chain (§4). Neither
is pushed or handed to a hook: like a Talk turn, each gets the `message` event only.

### The card

A `card` record's plaintext is JSON; the card's id is the record's own `txid`, which no
plaintext can name:

```json
{
  "title": "Top 5 for the next 30 minutes",
  "prompt": "top5",
  "thread": { "bead": "mw-abc" },
  "items": [
    { "n": 1, "text": "VERIFIED on the stream story", "links": ["mw-f758y.30.2"],
      "expect": { "bead": "mw-f758y.30.2", "state": "verified" } }
  ],
  "subscribe": { "kinds": ["bead_changed"], "beads": ["mw-f758y.30.2"] }
}
```

- `thread` — optional; the bead whose channel the card was sent to. Absent, the card is in
  Factory.
- `items[]` — `n` (from 1), `text`, `links` (bead ids: where to go), an optional `expect` (the
  bead and the state that ticks the item: `open`, `landed`, `verified`, `closed` or `answered`),
  and `done` and `done_at` (Unix seconds) once ticked. A card is sent with neither.
- `subscribe` — the event kinds and beads the card listens to (§22).

### The update

A `card-update` record's plaintext names its card by `re` (the card's `txid`) and changes it:

```json
{ "re": "<card txid>", "items": [ { "n": 4, "text": "…", "links": [] } ],
  "links": { "2": ["mw-f758y.30.5"] }, "tick": [1] }
```

`items` are added, or replace the item with the same `n`; `links` adds bead ids to an item;
`tick` marks items done at the update's time. Updates apply in the order sent (record `seq`),
whatever order they page in; one that pages in before its card waits for it.

### What the app does with them

`mw-nqur1n.11`. A card or update is kept as a message row (so a phone that was locked reads
it once unlocked) but is never a message: no thread, unread count or search hit shows it, and
only one received by this key is read. It is folded into the Dexie `cards` table, keyed by the
card's `txid`: the record, its updates, and this phone's own ticks. The card shows in Needs you
under You while any item is open (`Cards · N`), and in the thread named by `thread` (the bead's
page and its channel), as a numbered list with each link a link to that bead's page.

The card listens to its `subscribe` through `useEvents` (§22). An item with an `expect` is done,
with the event's time, when a held event is the bead moving to a state that settles it, or a
`card_answered` on the bead for `answered`, no earlier than the item was sent. An event is a move
only when its `from` differs from its `to`: a `bead_changed` with the two equal (a comment on the
bead, say) ticks nothing. What settles each `expect.state`: `landed` is met by a move to `landed`,
`verified` or `closed` (landing leads on to the others); `verified` by a move to `verified` and
nothing else (a story closes at landing, before anyone has checked it, so `closed` does not
satisfy it); `closed` by a move to `closed`; any other state by a move to that state. That tick is
the app's own: nothing is sent, and no view or record is fetched. A card with every item done
leaves You and shows under `Done · N`.
