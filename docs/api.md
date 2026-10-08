# Postern backend API

The contract the PWA and `mw` build against. Implemented in `server/internal/api`,
backed by an append-only store (`server/internal/index`) that two channels feed:
one WhatsOnChain poller (`server/internal/poller`) indexing the postern anchor
address, and direct delivery (`POST /api/messages`, `docs/protocol.md` §9). Every
newly indexed record, from either channel, goes through one fan-out: a web push,
an event on the event stream, and the on-message hook (see *The record fan-out*).

The backend binds `127.0.0.1` by default (`POSTERN_ADDR`); it runs on the
Governor's desktop, and the VPS reaches it over WireGuard through an nginx proxy,
not directly (see *Recommended desktop setup*).

Every error response, from every endpoint below, is:

```json
{ "error": "<message>" }
```

## Authentication

Every endpoint below except `GET /healthz` and `GET /api/challenge` requires proof
that the caller holds a licensed key: an `Authorization` header of the form

```
Authorization: Postern <pubkeyHex>:<nonceHex>:<sigHex>
```

- `pubkeyHex` — the caller's compressed secp256k1 public key, hex.
- `nonceHex` — a nonce this backend issued from `GET /api/challenge` and hasn't
  already consumed.
- `sigHex` — a DER-encoded ECDSA signature, by `pubkeyHex`, over
  `sha256(nonceHex)` (the nonce string's UTF-8 bytes) — matching `@bsv/sdk`'s
  `PrivateKey.sign(nonceString)` (a single SHA-256, not a double hash) and
  `Signature.toDER()`.

A nonce is consumed the moment it's presented and verified — it can never be
reused on that backend, whether the proof it backed succeeded or failed. It also
expires a short time (a few minutes) after being issued.

A nonce is verifiable by any backend holding the same key: it carries its own
expiry and a MAC (see `GET /api/challenge`), so the standby that answered the
challenge and the home that receives the signed request agree on it. Only the
single-use record is per process.

- `401` — the header is missing or malformed, the nonce is unknown/expired/already
  used, the signature doesn't verify, or the key holds no licence. The body is
  `{"error": "<words>", "reason": "<code>"}`; the app matches on `reason`, never on
  `error`: `malformed_authorization`, `nonce`, `signature` or `no_licence`. Only
  `no_licence` is about a licence; the app retries a `nonce` refusal once with a
  fresh challenge (nothing has been acted on when it is refused).
- `403` — a proved, licensed key whose licence does not open the route; `reason`
  is `forbidden`.

Every refusal (each 401 and the 403) writes one log line: the status, the route,
the reason in words and its code, and the key's first 12 hex characters (`-` when
the request named none) — never a body, a signature or a nonce.
- `502` — the licence check itself failed (a chain read failing), distinct from a
  bad proof.

The licence check is `docs/protocol.md` §16's rule (`server/internal/licence`). A
key holds a licence when a transaction in its own testnet address's history — or
in the issuer's, when `POSTERN_ISSUER_KEY` is set — carries a typed M record
(`nftgate` version `0x02`) that:

- names the key's own testnet address as `holder`, in one of `POSTERN_COLLECTIONS`;
- is **issued**: when `POSTERN_ISSUER_KEY` is set, at least one input of the mint
  transaction has a P2PKH scriptSig (`<sig> <pubkey>`) whose public-key push is
  that key **and** spends an output that is P2PKH to hash160 of that key, so the
  network checked the signature against it (a scriptSig that merely pushes the key
  over, say, an `OP_2DROP OP_1` output proves nothing). The spent output's
  transaction comes from the histories already read, or one `GET /tx/{txid}/hex`
  per candidate mint or revoke otherwise; a read that fails fails the check (so the
  checker's stale grace keeps the last answer), and one that does not parse or
  has no such output means the mint does not count. With no issuer configured the backend logs a warning at start and any
  mint naming the key counts (the old self-mint rule);
- is **not transferred away**: the licence token sits at output 0 of the mint (both
  of spell-forge-bsv's mint layouts; the contract mint writes `[0]` the License,
  `[1]` the Fuel, `[2]` the M record, `[3]` the issuer's change). Every
  transaction seen spending the token's current outpoint moves it to that
  transaction's output 0; one carrying a TR record also moves it to the address
  the record's `to` names. A TR payload may be the library's `{"to": "<address>"}`
  or the older `{"origin", "to"}`; either way it is tied to the licence only by
  the outpoint its transaction spends, never by the payload. The licence holds if
  the token still rests with the key's address.

Only transactions in those address histories are seen: a transfer paid wholly
from the licence's Fuel touches no P2PKH address, so it goes unseen until
something (a payment, change, the holder's own coin) puts it in one of them. The
answer is cached a bounded time (5 minutes) per key so a proved request doesn't
re-walk the chain every time.

### Who may do what (`docs/protocol.md` §19)

A proved key is one of three kinds, and each endpoint below admits only some:

- a **cockpit** key holds a licence in one of `POSTERN_COLLECTIONS`: every
  endpoint, exactly as before §19;
- the **mill** key is `POSTERN_MILL_KEY`, vouched for by configuration (it needs
  no licence, only the signed proof): `GET/POST /api/messages`, `GET /api/me`,
  `GET /api/blobs/{hash}`, and `DELETE /api/blobs/{hash}` for a blob whose
  uploader has sent a grist to the mill;
- an **app** key holds a licence only in an app's collection (`POSTERN_APPS`):
  `GET/POST /api/messages`, `GET /api/me`, `POST /api/blobs`,
  `GET /api/push/vapid-public-key`, `POST /api/push/subscribe`.

A proved key of a kind an endpoint does not admit gets `403`. A key holding both a
cockpit and an app licence is a cockpit key.

## GET /healthz

Liveness check, and which build is running. Served by the backend at `/healthz`;
the site's proxy reaches it as `/api/healthz`.

- `200 application/json`:

  ```json
  { "ok": true, "standby": false, "commit": "0a560d1" }
  ```

  `commit` is the short git revision the running binary was built from, so a
  backend swap is verified from this line instead of a `cmp` of the binary. It is
  the Go toolchain's own `vcs.revision` stamp (`runtime/debug.ReadBuildInfo`), so
  `go build -o {out} ./cmd/postern` needs no flag; a build may override it with
  `-ldflags "-X github.com/Jonathan-A-White/postern/server/internal/buildinfo.commit=<rev>"`.
  It reads `dev` when the build carries neither (a `go run`, or a build outside a
  git checkout). In standby the same line answers with `"standby": true` and
  `"home": …`, still carrying `commit`.

## GET /api/challenge

Issues a nonce for the caller to sign (see Authentication, above).

- `200 application/json`:

  ```json
  { "nonce": "3af1b2c3..." }
  ```

The nonce is always plain lowercase hex: 112 characters, the bytes
`expiry(8, big-endian unix nanoseconds) || salt(16) || HMAC-SHA256(key, expiry || salt)(32)`.
The key is 32 random bytes kept as hex in `POSTERN_DATA/postern-nonce.key` (mode
600), created on first start and reused after a restart. **The boost needs the same
key** — `mw postern mirror` copies it with the rest of `POSTERN_DATA` — or a
challenge from one backend is refused by the other (nginx round-robins `/api` over
both). The app refuses to sign
anything else: the same key signs a hands step's approval (`docs/protocol.md` §17),
and a challenge must never be able to stand in for one.


## GET /api/messages?since=\<seq\>[&limit=\<n\>]

Returns the indexed records after sequence number `since`, oldest first: all of
them, or with `limit` one page. For an
app's key or the mill's, only the records whose envelope names the caller as `to`
or `from` (`docs/protocol.md` §19); a page is cut from the whole index before
that filter, so `next` moves past records the caller cannot see.

- `since` (query, optional) — a non-negative integer. Defaults to `0` (return
  everything indexed so far).
- `limit` (query, optional) — the most records one answer carries. Absent: no
  limit, every record after `since`, as before. Present: an integer from `1`;
  anything above the cap of `500` is clamped to `500`. `0`, a negative number or
  anything that is not an integer is `400` with a reason.
- `200 application/json`:

  ```json
  {
    "records": [
      {
        "seq": 2,
        "txid": "3af1...",
        "vout": 0,
        "scriptHex": "006a076e667467617465010127...",
        "height": 0,
        "firstSeen": "2026-09-24T12:00:03.512Z",
        "signer": "035666d4ea414a65801ac092a4e28be6515065adcc7ac58d9cc76db8d5597f44c4",
        "payload": {
          "v": 1,
          "kind": "msg",
          "class": "message",
          "to": "029cbf013d04ca50ba852816c2802b06ca5ed37b44be9597fc0f95360e209afa97",
          "from": "039d1abaec9f5715a15c7628244170951e0f85e87f68ca5393d3f9fc3fa23a69c8",
          "ts": 1758700000,
          "ct": "QkIQMwOdGrrsn1cVoVx2KCRBcJUeD4Xof2jKU5PT+fw/ojppyAKcvwE9BMpQuoUoFsKAKwbKXtN7RL6Vl/wPlTYOIJr6ly29yXkTykfSVSTrUVnERI/lCUsFLuvVhgyN79hFczet0W67HhaxJRMUSM/BXPUDPdFB/gQbllS0XYOgVPldzejkyjylJbipQqP4YgfBX9ZMXE8wgY4FS6wVF6bMvLwC4WA0bupV8apiP8jK9Q==",
          "summary": "Answer: Pick the colour"
        }
      }
    ],
    "next": 2,
    "more": false
  }
  ```

  - `records` — every stored record with `seq > since`, oldest first (at most
    `limit` of them, if given). Empty (`[]`) if there's nothing newer.
  - `next` — the cursor for the following request. On a truncated page (`more`
    true) it is the sequence number of the last record scanned into the page,
    whether or not the caller may see it, so a page that filters to nothing
    still moves on. Otherwise it is the index head (or `since`, if that is
    already past the head).
  - `more` — `true` if records beyond this page remain, so the client asks again
    with `since=next`; `false` once it has the head. Without `limit` it is always
    `false`.
  - `height` — the confirming block height, or `0` if the transaction was
    still unconfirmed when indexed.
  - `txid` — the carrying transaction's id, or `direct:<sha256 hex of the
    script bytes>` for a record delivered by `POST /api/messages` (a real txid
    is 64 hex characters and never contains `:`). A direct record always has
    `vout` 0 and `height` 0.
  - `signer` — the hex-encoded public key that signed the carrying
    transaction: the second push of its first input's scriptSig (the
    standard P2PKH unlocking script `<sig> <pubkey>`). Omitted if that
    input's scriptSig isn't shaped that way (not exactly two pushes, or the
    second push isn't a 33- or 65-byte SEC public key) — this backend
    doesn't verify the signature itself, only extracts the key. For a direct
    record it is the key whose challenge signature authenticated the
    delivery, lower-case hex.
  - `chain` — direct records only: `sha256(prevChain || txid)` as hex, where
    `prevChain` is the previous direct record's `chain` decoded from hex (32
    zero bytes for the first) and `txid` is the `direct:` name's UTF-8 bytes.
    Informational until an anchoring job commits it on chain.
  - `payload` — the record's version-1 payload, re-parsed as JSON, if the
    record was version 1 and its payload parsed as JSON. Omitted for any other
    record (a different version, or a version-1 payload that didn't parse).
    The backend never decrypts a `ct` field or any other content inside
    `payload` — it's stored and returned exactly as found on chain. Its shape
    is `docs/protocol.md` §1's envelope, the source of truth for the
    payload's fields (the example above is that section's Vector 1, §5).
  - `next` — the current index head sequence number. Pass this back as
    `since` on the next call to page forward; when `next` stops advancing,
    the client has caught up.
- `400` — `since` isn't a valid non-negative integer.

## POST /api/messages

Direct delivery (`docs/protocol.md` §9): indexes a §1 record script posted
straight to the backend, beside the chain's records.

An app's key may post only `"class": "grist"` addressed to the mill; the mill's
key only `grist`, to anyone; anything else from either is `403`. Each stored
record carries `signer_apps` when its signer's licences open apps
(`docs/protocol.md` §19).

- Request body (at most 256 KiB):

  ```json
  { "scriptHex": "006a076e667467617465010127...", "clientId": "3f0c9a41d2b8470e9a5c1e66b7d20f13" }
  ```

  `scriptHex` — the §1 record script, `OP_FALSE OP_RETURN <'nftgate'> <0x01>
  <payload>`, as hex (either case).
  `clientId` — optional: the phone's outbox row's id (1 to 128 letters, digits, `-`
  or `_`). A post whose key and `clientId` were accepted in the last 24 hours is
  answered `200` with that first acceptance, whatever script it carries (a retry
  is freshly encrypted, so its bytes differ).
- `201 application/json` — a record not already stored:

  ```json
  { "txid": "direct:9f2c...", "seq": 43 }
  ```

  `txid` is `direct:` plus the sha256 hex of the script bytes; `seq` its index
  sequence number. The record is then fanned out like any newly indexed record:
  a web push to the recipient's subscriptions, a `message` event on
  `GET /api/events`, and the on-message hook.
- `200 application/json` — the same shape, when those exact script bytes are
  already stored: the stored record's `txid` and `seq`, nothing re-indexed or
  re-sent. A retry is harmless. The same answer, too, for a `clientId` already
  accepted from this key (`docs/protocol.md` §9).
- `400` — the body isn't JSON, `scriptHex` is missing or not hex, `clientId` is
  malformed, the script isn't
  an `nftgate` version-1 record with a JSON payload, or the payload isn't §1's
  envelope (`v` 1, `kind` `"msg"`, `class` one of `message`, `decision-needed`,
  `landing`, `alarm`, `move-home`, 66-hex `to` and `from`, numeric `ts`, string `ct`); `error`
  names what is wrong.
- `403` — the payload's `from` isn't the key that authenticated the request.
- `413` — the body exceeds 256 KiB.

## POST /api/broadcast

Forwards a raw transaction to WhatsOnChain.

- Request body:

  ```json
  { "rawtx": "0100000001..." }
  ```

- `200 application/json` on success:

  ```json
  { "txid": "3af1..." }
  ```

- `400` — the body isn't valid JSON, or `rawtx` is missing/empty.
- `502` — WhatsOnChain rejected the transaction or couldn't be reached; `error`
  carries the provider's own status and message where one was returned (e.g.
  `"WhatsOnChain said 400: tx rejected: bad-txns-inputs-missingorspent"`).

## GET /api/utxos/{address}

Proxies WhatsOnChain's unspent-output list for `address`, so `mw` can build
transactions without talking to WhatsOnChain directly.

- `200 application/json`:

  ```json
  {
    "utxos": [
      { "txid": "3af1...", "vout": 0, "satoshis": 1000, "height": 100 }
    ]
  }
  ```

  `height` is `0` for an unconfirmed output.
- `502` — the provider proxy failed; `error` carries what's known of why.

## GET /api/balance/{address}

Proxies WhatsOnChain's balance for `address`.

- `200 application/json`:

  ```json
  { "confirmed": 100000, "unconfirmed": 0 }
  ```

  Both fields are satoshis.
- `502` — the provider proxy failed; `error` carries what's known of why.

## GET /api/push/vapid-public-key

Returns this backend's VAPID public key, for the app to pass as
`applicationServerKey` when it subscribes (`PushManager.subscribe`).

- `200 application/json`:

  ```json
  { "publicKey": "<base64url>" }
  ```

## POST /api/push/subscribe

Registers a browser's `PushSubscription` against a recipient public key, so a
future record addressed to that key (its payload's `to`, `docs/protocol.md`)
triggers a push to it.

- Request body:

  ```json
  {
    "pubkey": "<recipient compressed public key hex>",
    "subscription": {
      "endpoint": "https://...",
      "keys": { "p256dh": "<base64url>", "auth": "<base64url>" }
    }
  }
  ```

- `200 application/json` — `{}` on success. Re-subscribing with the same
  `endpoint` replaces the stored subscription (its `pubkey` and keys, if
  either changed).
- `400` — the body isn't valid JSON, or `pubkey`/`subscription.endpoint` is
  missing.
- `403` — `pubkey` is not the key that signed the request: a key subscribes only
  its own pushes.

## POST /api/blobs

Uploads an encrypted attachment (`docs/protocol.md` §8): the request body is
the ciphertext as-is, addressed by its own sha256.

- Request body: raw bytes, at most 8 MiB plus 256 bytes of BRC-78 envelope
  overhead.
- `201 application/json` — a body not already stored:

  ```json
  { "hash": "3af1...", "size": 483920 }
  ```

- `200 application/json` — the same shape, for a repeat upload of bytes
  already stored; the existing blob is kept, not duplicated.
- `413` — the body exceeds the size cap.

The stored body is kept under `POSTERN_DATA/blobs/<hash>` for 30 days from
upload, then deleted.

## GET /api/blobs/{hash}

Streams back a previously uploaded attachment.

- `200 application/octet-stream` — the body as uploaded.
- `404` — `hash` isn't 64 lowercase hex characters, or names no blob
  currently on disk (never uploaded, or its 30 days have passed).

## DELETE /api/blobs/{hash}

Removes an attachment at once rather than after 30 days: the mill deletes a
grist's photos once it has answered (`docs/protocol.md` §19). Cockpit and mill
keys only. A grist's attachments are sealed, so the backend cannot read which blobs
one names: it records who first uploaded each blob, and the mill key may delete a
blob only if that uploader has sent a grist addressed to the mill. Any other blob
(the Governor's own photos, say) is `403` to the mill. A cockpit key may delete any
blob.

- `204` — deleted.
- `403` — the caller is the mill key and no grist to the mill names this blob's
  uploader (or the blob predates upload owners being recorded).
- `404` — `hash` isn't 64 lowercase hex characters, or names no blob on disk.

The store never looks at what the bytes are: any attachment `mime` the
plaintext names (`docs/protocol.md` §14: images, audio, PDF, plain text) is
stored and served the same way, under the same cap.

## GET /api/events

The event stream (`docs/protocol.md` §10). Answers `200 text/event-stream`, with
`Cache-Control: no-store` and `X-Accel-Buffering: no`, and stays open; each event
is flushed as it is written:

```
event: hello
data: {"head":42,"view":"\"9f86d081...\""}

event: message
data: {"seq":43}

event: view
data: {"etag":"\"60303ae2...\""}

: ping
```

- `hello` — sent once on connect: `head` is the index's latest sequence number
  (`0` when empty) and `view` the current view's ETag, or `""` when there is no
  view.
- `message` — a record was indexed, by either channel; `seq` is its sequence
  number. Page `GET /api/messages?since=` from your own cursor.
- `view` — the view file changed; `etag` is its new ETag (`""` if it was
  removed).
- `: ping` — a comment every 25 seconds, so no proxy idles the stream out.

A view ETag here is exactly the `ETag` header `GET /api/view` answers, double
quotes included, so it can be sent back as `If-None-Match` as it stands.

The subscription is taken before `hello` is built, so nothing indexed in between
is missed. A client that stops reading is disconnected once it falls 64 events
behind (never waited on); it reconnects and its fresh `hello` says what it
missed. Browsers read the stream with `fetch` (`EventSource` cannot send the
`Authorization` header); the nonce is consumed when the stream opens.

A cockpit key may open the stream, and so may the Mayor's key
(`POSTERN_MAYOR_KEY`) without a licence: configuration vouches for it, as for
the mill's, and a failing licence check does not refuse it the stream. Without a
licence the Mayor's key gets `403` from every other route (`docs/protocol.md`
§20).

## GET /api/presence

Whether the Mayor is here (`docs/protocol.md` §20, "Presence"). A cockpit key only
(the Mayor's unlicensed key gets `403`, as from every route but the stream).

```json
{ "mayor": true }
```

`mayor` is `true` while the Mayor's key (`POSTERN_MAYOR_KEY`) holds `GET /api/events`
open (that is, while an `mw talk wait` is armed) and for 120 seconds (`PRESENCE_GRACE`)
after the last such stream closed, and `false` otherwise, including when
`POSTERN_MAYOR_KEY` is unset. `Cache-Control: no-store`. The backend counts open
streams per key, and when each key's last one closed, in memory: a restart forgets them
until the streams reconnect.

## GET /api/view

The live view (`docs/protocol.md` §11): the bytes of `POSTERN_VIEW_FILE` as they
stand on disk.

- `200 text/plain; charset=utf-8` — the file's bytes (the base64 BRC-78
  ciphertext `mw postern view` wrote), with `ETag: "<sha256 hex of the bytes>"`
  and `Cache-Control: no-store`.
- `304` — `If-None-Match` names the current ETag (any entry of a list, weak or
  not, or `*`); same `ETag` and `Cache-Control`, no body.
- `404` — `{"error": "no view written yet"}`: `POSTERN_VIEW_FILE` is unset or the
  file doesn't exist.

The backend checks the file's size, mtime and identity every second; when they
move and the bytes' ETag changes it sends a `view` event on `GET /api/events`.

## GET /api/beads/{id}

One bead's full detail (`docs/protocol.md` §12). The backend runs
`POSTERN_BEAD_CMD` (on the factory's host, `mw postern bead`), split on whitespace,
with `id` appended as its own argument — never through a shell — and answers its
output.

- `200 text/plain; charset=utf-8` — the command's stdout as it stands (§11's
  encoding of §12's JSON), with `Cache-Control: no-store`.
- `400` — `id` isn't `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` (checked before anything
  else).
- `404` — the command exited with status 3 and stderr empty or saying there is no such
  bead. Status 3 with any other stderr (a locked database, say) is a 502.
- `501` — `POSTERN_BEAD_CMD` is not configured.
- `502` — anything else: another exit status, the command couldn't start, or no
  answer within 25 seconds (it is then killed); `error` names the timeout, or the exit
  status (`exit 3`) and the start of its stderr. Each 502 also leaves one line in the
  journal: the bead id, the seconds it ran and the reason (`timeout after 25s`, or the
  exit status and the last 300 bytes of stderr).

## GET /api/me

Who the caller is, who the Mayor is and who the mill is (`docs/protocol.md` §15,
§19).

- `200 application/json`:

  ```json
  {
    "pubkey": "039d1abaec9f5715a15c7628244170951e0f85e87f68ca5393d3f9fc3fa23a69c8",
    "mayor": "029cbf013d04ca50ba852816c2802b06ca5ed37b44be9597fc0f95360e209afa97",
    "network": "testnet",
    "features": ["direct", "events", "view", "beads", "me"]
  }
  ```

  - `pubkey` — the key that authenticated this request, lower-case hex.
  - `mayor` — `POSTERN_MAYOR_KEY`, or `""` when unset.
  - `mill` — `POSTERN_MILL_KEY`; absent when unset.
  - `network` — `POSTERN_NETWORK`.
  - `features` — what this backend offers; `grist` too when a mill key is set.
  - `collections` — a cockpit key only: `[{"name"}, …]` for `POSTERN_COLLECTIONS`,
    then `{"name", "app"}` for each collection of `POSTERN_APPS`, in the order
    configured.
  - `issuer` — a cockpit key only: the testnet address of `POSTERN_ISSUER_KEY`;
    absent when that key is unset.

  An app's key or the mill's gets `{"pubkey", "mill", "network", "features":
  ["grist"], "apps"}` instead: never the Mayor, and `apps` names the apps its
  licences open.
- `401` — as for every endpoint, which includes a key holding no licence: the
  app's cue to offer the licence screen.

## Saved prompts (`/api/prompts`)

`GET /api/prompts`, `GET|PUT|DELETE /api/prompts/{name}`: the routes, keys and the
record are in `server/README.md` and `docs/protocol.md` §23. An option's `type` is
`duration`, `string`, `int`, `bool` or `text`. `text` is the free-text option, the
words of a call that no flag takes (`/later a licence for Luke`): a signature has at
most one, and a `PUT` with two answers `400 {"error": "options --a and --b are both
free-text: a prompt has one"}`.

## The record fan-out

Every record newly stored in the index — found on chain by the poller, or
delivered to `POST /api/messages` — goes through one `notify.Fanout`
(`server/internal/notify`): the push notifier, a `message` event on
`GET /api/events`, and the on-message hook. A repeat delivery of a stored record
goes through none of them. A `talk` record (`docs/protocol.md` §20), a `call`
record (§21) or an `events` record (§22) gets the `message` event only: no push, and no hook of either kind. The two
exceptions are a `call` record whose clear `role` is `ring` (the Mayor's call-back), which is
pushed as well, with the title `The Mayor is calling` and, for a direct record, its
`summary` as the body, and an `events` record whose clear `lane` is `emergency`, which is
pushed with the title `Emergency` and no body (still no hook), and a `talk` record signed by the Mayor's key (`POSTERN_MAYOR_KEY`) to anyone else, the Mayor's answer, which is pushed as `{class: "talk", txid, ts}` with no words, no title and no body (still no hook; the Governor's own turns are never pushed).

## The push notifier

Every newly indexed record is handed to a `push.Sender`, which, in the
background, parses the payload for `to` and `class` (`docs/protocol.md`) and, for
each subscription registered against that `to`, sends a Web Push (RFC 8291/8292,
via `github.com/SherClockHolmes/webpush-go`) whose body is:

```json
{ "class": "alarm", "txid": "3af1...", "ts": 1758700000 }
```

Nothing the sender did not put in the clear leaves the backend in a push — the
app decrypts the record's `ct` itself once it syncs. The one clear text a record's
push may carry is a direct record's `summary` (`docs/protocol.md` §1), trimmed and
cut to 80 runes, as the push's `body`, only when the class is `message`,
`decision-needed`, `landing` or `alarm`; a chain record's `summary` and a `grist`
record's are ignored, and a record with no `summary` pushes exactly as above. A
record with no `to`/`class` (a License mint/transfer record, for instance) or a
`to` no device has subscribed for is silently skipped. A push endpoint that
answers `410 Gone` or `404` has its subscription dropped from the store.

One notification per message: the Mayor's post reaches the backend twice, direct and, a little later,
on chain under its own transaction id, and the phone keeps only the direct row. The sender remembers
the twin key of each record it pushed (`to`, `from`, `ts` and a hash of `ct`, what the app's
`sameMessage` compares) for 24 hours, at most 4096 keys in memory, and skips a later record with the
same key, whichever copy came first. A push that reached no device is not remembered. A record with
no `ct` is never a twin.

A `message` record that names its channel in the clear (`docs/protocol.md` §1: an optional `bead`
id, or an optional `channel` name; a bead outranks a name, each cut to 80 runes) is pushed with the
title `Message on <bead id>` or `Message in <name>`, direct or chain alike; with neither, it has no
title and the app's own `Message` stands. No other class takes a channel title, and an emergency
keeps `Emergency`:

```json
{ "class": "message", "txid": "direct:9c1e...", "ts": 1758700000, "title": "Message in general", "body": "Closing six now..." }
```

A push may also carry two optional fields, `title` and `body`, which the service
worker shows when present. A record's push never has a `title`, but for a ring, an emergency, and a message that names its channel, and
has a `body` only from a direct record's `summary`:

```json
{ "class": "decision-needed", "txid": "direct:9c1e...", "ts": 1758700000, "body": "Answer: Pick the colour" }
```

A ring, a `call` record whose clear `role` is `ring` (`docs/protocol.md` §21), is pushed
with `"class": "call"` and the title `The Mayor is calling`; a direct ring's `summary`
is its `body`, and a chain ring has no body:

```json
{ "class": "call", "txid": "direct:5d0a...", "ts": 1758700000, "title": "The Mayor is calling", "body": "Back now: two landings." }
```

A push with no record behind it (the watchdog's, below) has no `txid`:

```json
{ "class": "alarm", "ts": 1758700000, "title": "desktop unreachable", "body": "since 12:04Z" }
```

VAPID keys are generated once into `POSTERN_DATA/postern-vapid.json` the
first time this backend runs, unless `POSTERN_VAPID_PUBLIC_KEY` and
`POSTERN_VAPID_PRIVATE_KEY` are both set, in which case those are used
instead and nothing is written to disk. Subscriptions are persisted in
`POSTERN_DATA/postern-push-subscriptions.json`.

## The on-message hook

When `POSTERN_ON_MESSAGE` is set, the backend runs it through `sh -c` after
records are indexed (on the factory's host, `mw postern inbox --apply`, which
applies the Governor's actions, `docs/protocol.md` §13):

- **debounced** — the run starts one second after the first record of a burst,
  and every record indexed in that second shares it;
- **never two at once** — a record indexed while a run is going earns exactly one
  more run, started as soon as the current one ends;
- each run is killed after **5 minutes**; its combined output (and any failure) is
  logged.

The hook inherits the backend's environment and working directory. It is not run
for any grist, to the mill or to anyone; a grist for the mill wakes the on-grist
hook instead.

## The on-grist hook

When `POSTERN_ON_GRIST` is set, the backend runs it the same way (debounced,
never two at once, the same kill) after a grist addressed to `POSTERN_MILL_KEY`
is indexed: on the factory's host, `mw grist grind` (`docs/protocol.md` §19).

## Standby

When `POSTERN_HOME_CMD` is set, the backend runs it through `sh -c` at start and
every 30 seconds (10-second limit): **exit 0 means this host is home**, anything
else (a failing exit, a missing command, a timeout) means **standby**. Both hosts
run the backend all the time and nginx fails over on `503`, so the host that is
not home must not act as a second backend. In standby:

- every `/api` route answers `503` with `{"standby": true, "home": "<what the
  command printed>"}` (`home` is omitted when it printed nothing) before doing
  any work, **except** the routes a send needs: `GET /api/challenge`,
  `POST /api/messages`, `GET /api/me`, `GET /api/utxos/{address}` and
  `POST /api/broadcast`, so a move-home message can still be sent when the home
  is dead. With `POSTERN_PEERS` naming the home's backend these five are
  relayed to it unchanged and the home's answer returned as is, so the home
  does the work once; they are served here only when the home cannot be
  reached at all (see below);
- `GET /healthz` answers `200` with `{"ok": true, "standby": true, "home": …, "commit": …}`;
- web push notifications are not sent;
- the chain poll still runs and the index is kept, the event hub still hears
  every record, and the on-message hook still runs (`mw` decides what to apply).

`POSTERN_PEERS` is a comma list of `<host>=<url>` (e.g.
`laptop=http://10.88.0.2:8787,desktop=http://10.88.0.3:8787`), looked up by the
name the home command printed. A relay that cannot connect to the home (refused,
or no connection within 3 seconds; logged) is served here as before; once the
home has any of the request a failure is a `502` and the request is never served
here, so a POST does not run twice. With no URL for the home (logged once) every
send route is served here. A relayed request carries `X-Postern-Relayed: 1`, and
a standby that receives one serves it itself. The home ignores `POSTERN_PEERS`.

With `POSTERN_HOME_CMD` unset, nothing changes.

## Configuration (environment)

| Variable | Meaning | Default |
|---|---|---|
| `POSTERN_ADDR` | Address the HTTP server binds | `127.0.0.1:8787` |
| `POSTERN_NETWORK` | Network label (informational; doesn't affect request URLs) | `testnet` |
| `POSTERN_ANCHOR` | The anchor address the poller watches | *(required, no default)* |
| `POSTERN_WOC_BASE` | WhatsOnChain API base URL | `https://api.whatsonchain.com/v1/bsv/test` |
| `POSTERN_DATA` | Directory holding the index (`postern-index.jsonl`), push state, the challenge key (`postern-nonce.key`), attachment blobs (`blobs/`), and what the licence walk keeps across a restart: each key's last answer (`licence-answers.json`) and every transaction it fetched (`licence-txs/`), so a backend swap serves from the last answer while a background walk refreshes it | `./data` |
| `POSTERN_VAPID_PUBLIC_KEY` | VAPID public key (skips generation if both keys are set) | *(generated into `POSTERN_DATA`)* |
| `POSTERN_VAPID_PRIVATE_KEY` | VAPID private key (skips generation if both keys are set) | *(generated into `POSTERN_DATA`)* |
| `POSTERN_PUSH_SUBSCRIBER` | The VAPID contact (an https URL or `mailto:` email) sent to push services | `https://postern.allmymind.org` |
| `POSTERN_VIEW_FILE` | The encrypted view file `mw postern view` writes, served by `GET /api/view` and watched for `view` events | *(unset: `GET /api/view` answers 404)* |
| `POSTERN_BEAD_CMD` | The command `GET /api/beads/{id}` runs, split on whitespace, the id appended (e.g. `mw postern bead`) | *(unset: 501)* |
| `POSTERN_ON_MESSAGE` | Shell command (`sh -c`) run after records are indexed (e.g. `mw postern inbox --apply`) | *(unset: no hook)* |
| `POSTERN_HOME_CMD` | Shell command (`sh -c`), exit 0 = this host is home (e.g. `mw home --check`); checked at start and every 30 s; see Standby | *(unset: never standby)* |
| `POSTERN_PEERS` | Comma-separated `host=url` pairs (each url `http(s)://host[:port]`, no path): each host's backend, looked up by the home's name so a standby relays its send routes to the home; see Standby | *(unset: a standby serves the send routes itself)* |
| `POSTERN_MAYOR_KEY` | The Mayor's compressed public key, hex (66 characters, `02`/`03` first), answered by `GET /api/me`; it may read `GET /api/events` without a licence | *(unset: `""`)* |
| `POSTERN_ISSUER_KEY` | The licence issuer's compressed public key, hex (66 characters, `02`/`03` first); a mint counts only if this key unlocked one of its inputs | *(unset: any mint counts, with a warning)* |
| `POSTERN_COLLECTIONS` | Comma-separated collections a licence mint may name | `postern,spellforge-leaderboard-testnet` |
| `POSTERN_MILL_KEY` | The mill's compressed public key, hex (`docs/protocol.md` §19) | *(unset: no grist)* |
| `POSTERN_APPS` | Comma-separated `collection=app` pairs: each app's licence collection and the app it opens the grist door to; never one of `POSTERN_COLLECTIONS` | *(unset: no app keys)* |
| `POSTERN_ON_GRIST` | Shell command (`sh -c`) run after a grist for the mill is indexed (e.g. `mw grist grind`) | *(unset: no hook)* |
| `POSTERN_CORS_ORIGINS` | Comma-separated origins (`https://host[:port]`, lower-cased at load and matched case-insensitively) allowed to call the backend from a browser on another origin | *(unset: no CORS headers)* |

A malformed `POSTERN_MAYOR_KEY`, `POSTERN_ISSUER_KEY` or `POSTERN_MILL_KEY`, a
`POSTERN_COLLECTIONS` naming no collection, a malformed `POSTERN_APPS` pair or one
naming a cockpit collection, or a `POSTERN_CORS_ORIGINS` entry that is not an
origin, stops the backend at start. So does half a grist door: `POSTERN_APPS` or
`POSTERN_ON_GRIST` without `POSTERN_MILL_KEY`, or `POSTERN_MILL_KEY` without
`POSTERN_APPS`; the error names the missing setting.

## The poller

A background goroutine walks `POSTERN_ANCHOR`'s history (`GET
/address/{addr}/history` on WhatsOnChain) on a fixed interval. For every
transaction it hasn't already processed, it fetches the raw tx hex once,
inspects every output's locking script, and stores one index record for each
output shaped `OP_FALSE OP_RETURN <'nftgate'> <version> <payload>` — the
`nftgate` record framing `src/bsv/record.ts` defines (see
`docs/research/messages.md`). A transaction with no such output is still
marked processed, so it's never re-fetched.

Requests to WhatsOnChain (by the poller and by the `/api/utxos`,
`/api/balance`, and `/api/broadcast` proxies alike) are paced under its 3
requests/second limit and retried with exponential backoff on a `429`.

## The watchdog

`postern watchdog` (the same binary, first argument `watchdog`) is run once a
minute by a systemd timer on the VPS. Each run makes one `GET` of
`POSTERN_WATCH_URL` with a 10-second timeout; a `2xx` answer is up, anything else
(an error, a timeout, nginx's `502`) is down.

- Down for longer than `POSTERN_WATCH_AFTER` and not yet alerted: it pushes
  `{"class": "alarm", "title": "<Name> unreachable", "body": "since HH:MMZ", "ts": …}`
  to every stored subscription (the time is the first failed check, UTC) and
  marks the outage alerted.
- Up again after an alert: it pushes
  `{"class": "alarm", "title": "<Name> is back", "body": "down N min", "ts": …}`
  and clears the state. A shorter outage is forgotten without a push.
- A push that reaches no device at all is not recorded, so the next run retries
  it.

It exits `0` in every one of these cases, and non-zero only for a config fault: no
or malformed `POSTERN_WATCH_URL` or `POSTERN_WATCH_AFTER`, no VAPID keys, or a
`POSTERN_DATA` it cannot write.

| Variable | Meaning | Default |
|---|---|---|
| `POSTERN_WATCH_URL` | The URL to check, e.g. `http://desktop.mw:8787/healthz` | *(required)* |
| `POSTERN_WATCH_AFTER` | How long down before the alarm (a Go duration) | `3m` |
| `POSTERN_WATCH_NAME` | The target's name in the alarm's title | `desktop` |
| `POSTERN_DATA` | Holds `postern-vapid.json` and `postern-push-subscriptions.json`, copied there from the desktop's `POSTERN_DATA`, and the watchdog's own `watchdog-state.json` | `./data` |
| `POSTERN_PUSH_SUBSCRIBER` | The VAPID contact | `https://postern.allmymind.org` |

`POSTERN_VAPID_PUBLIC_KEY`/`POSTERN_VAPID_PRIVATE_KEY`, when both set, are used
instead of `postern-vapid.json`. The watchdog never generates keys: new ones would
match no browser's subscription.

## Recommended desktop setup

The backend runs on the Governor's desktop, bound to its WireGuard address so only
the tunnel reaches it:

```sh
POSTERN_ADDR=10.88.0.3:8787
POSTERN_ANCHOR=mt6vaAWeFxu2qC6pPs7bsqTNvv87dCwMW5
POSTERN_DATA=/var/lib/postern
POSTERN_VIEW_FILE=<mw's postern_view_path>
POSTERN_BEAD_CMD=mw postern bead
POSTERN_ON_MESSAGE=mw postern inbox --apply
POSTERN_MAYOR_KEY=<the Mayor's compressed public key>
POSTERN_ISSUER_KEY=<the licence issuer's compressed public key>
```

nginx on the VPS proxies `/api/` to it over WireGuard. The event stream needs its
own location: buffering off (the backend also sends `X-Accel-Buffering: no`) and a
read timeout far longer than the 25-second ping:

```nginx
location /api/events {
    proxy_pass http://10.88.0.3:8787;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
}

location /api/ {
    proxy_pass http://10.88.0.3:8787;
    client_max_body_size 9m;   # POST /api/blobs: 8 MiB plus envelope
}
```

The static site's own `location /` falls back to `index.html` (the app's routes are
`?v=` URLs, but a deep link or a reload must still land on the app). That fallback
must not cover `/assets/`: a hashed file that is missing has to be a 404, because
an answer of `200 text/html` for a missing `/assets/index-X.css` is what the
service worker once precached as a stylesheet (mw-j0f2d.41; the worker now refuses
and heals such entries, `src/precacheGuard.ts`, but the server should not say it):

```nginx
location /assets/ {
    try_files $uri =404;
}
```

The watchdog runs on the VPS with `POSTERN_WATCH_URL=http://10.88.0.3:8787/healthz`
(or the desktop's WireGuard name) and a copy of the desktop's
`postern-vapid.json` and `postern-push-subscriptions.json` in its own
`POSTERN_DATA`; recopy the subscriptions when a device subscribes anew.
