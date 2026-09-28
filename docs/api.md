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

A nonce is consumed the moment it's presented, valid or not — it can never be
reused, whether the proof it backed succeeded or failed. It also expires a short
time (a few minutes) after being issued.

- `401` — the header is missing or malformed, the nonce is unknown/expired/already
  used, the signature doesn't verify, or the key holds no licence.
- `502` — the licence check itself failed (a chain read failing), distinct from a
  bad proof.

The licence check is `docs/protocol.md` §16's rule (`server/internal/licence`). A
key holds a licence when a transaction in its own testnet address's history — or
in the issuer's, when `POSTERN_ISSUER_KEY` is set — carries a typed M record
(`nftgate` version `0x02`) that:

- names the key's own testnet address as `holder`, in one of `POSTERN_COLLECTIONS`;
- is **issued**: when `POSTERN_ISSUER_KEY` is set, at least one input of the mint
  transaction has a P2PKH scriptSig (`<sig> <pubkey>`) whose public-key push is
  that key. With no issuer configured the backend logs a warning at start and any
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

## GET /healthz

Liveness check.

- `200 text/plain` — body `ok`.

## GET /api/challenge

Issues a nonce for the caller to sign (see Authentication, above).

- `200 application/json`:

  ```json
  { "nonce": "3af1b2c3..." }
  ```

## GET /api/messages?since=\<seq\>

Returns every indexed record after sequence number `since`, oldest first.

- `since` (query, optional) — a non-negative integer. Defaults to `0` (return
  everything indexed so far).
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
          "ct": "QkIQMwOdGrrsn1cVoVx2KCRBcJUeD4Xof2jKU5PT+fw/ojppyAKcvwE9BMpQuoUoFsKAKwbKXtN7RL6Vl/wPlTYOIJr6ly29yXkTykfSVSTrUVnERI/lCUsFLuvVhgyN79hFczet0W67HhaxJRMUSM/BXPUDPdFB/gQbllS0XYOgVPldzejkyjylJbipQqP4YgfBX9ZMXE8wgY4FS6wVF6bMvLwC4WA0bupV8apiP8jK9Q=="
        }
      }
    ],
    "next": 2
  }
  ```

  - `records` — every stored record with `seq > since`, oldest first. Empty
    (`[]` or omitted, per Go's JSON encoding of a nil slice) if there's nothing
    newer.
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

- Request body (at most 256 KiB):

  ```json
  { "scriptHex": "006a076e667467617465010127..." }
  ```

  `scriptHex` — the §1 record script, `OP_FALSE OP_RETURN <'nftgate'> <0x01>
  <payload>`, as hex (either case).
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
  re-sent. A retry is harmless.
- `400` — the body isn't JSON, `scriptHex` is missing or not hex, the script isn't
  an `nftgate` version-1 record with a JSON payload, or the payload isn't §1's
  envelope (`v` 1, `kind` `"msg"`, `class` one of `message`, `decision-needed`,
  `landing`, `alarm`, 66-hex `to` and `from`, numeric `ts`, string `ct`); `error`
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
- `404` — the command exited with status 3 (no such bead).
- `501` — `POSTERN_BEAD_CMD` is not configured.
- `502` — anything else: another exit status, the command couldn't start, or no
  answer within 30 seconds (it is then killed); `error` carries the start of its
  stderr.

## GET /api/me

Who the caller is and who the Mayor is (`docs/protocol.md` §15).

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
  - `network` — `POSTERN_NETWORK`.
  - `features` — what this backend offers.
- `401` — as for every endpoint, which includes a key holding no licence: the
  app's cue to offer the licence screen.

## The record fan-out

Every record newly stored in the index — found on chain by the poller, or
delivered to `POST /api/messages` — goes through one `notify.Fanout`
(`server/internal/notify`): the push notifier, a `message` event on
`GET /api/events`, and the on-message hook. A repeat delivery of a stored record
goes through none of them.

## The push notifier

Every newly indexed record is handed to a `push.Sender`, which, in the
background, parses the payload for `to` and `class` (`docs/protocol.md`) and, for
each subscription registered against that `to`, sends a Web Push (RFC 8291/8292,
via `github.com/SherClockHolmes/webpush-go`) whose body is:

```json
{ "class": "alarm", "txid": "3af1...", "ts": 1758700000 }
```

No plaintext ever leaves the backend in a push — the app decrypts the
record's `ct` itself once it syncs. A record with no `to`/`class` (a License
mint/transfer record, for instance) or a `to` no device has subscribed for is
silently skipped. A push endpoint that answers `410 Gone` has its
subscription dropped from the store.

A push may also carry two optional fields, `title` and `body`, which the service
worker shows when present. A record's push never has them; only a push with no
record behind it does (the watchdog's, below), and such a push has no `txid`:

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

The hook inherits the backend's environment and working directory.

## Configuration (environment)

| Variable | Meaning | Default |
|---|---|---|
| `POSTERN_ADDR` | Address the HTTP server binds | `127.0.0.1:8787` |
| `POSTERN_NETWORK` | Network label (informational; doesn't affect request URLs) | `testnet` |
| `POSTERN_ANCHOR` | The anchor address the poller watches | *(required, no default)* |
| `POSTERN_WOC_BASE` | WhatsOnChain API base URL | `https://api.whatsonchain.com/v1/bsv/test` |
| `POSTERN_DATA` | Directory holding the index (`postern-index.jsonl`), push state, and attachment blobs (`blobs/`) | `./data` |
| `POSTERN_VAPID_PUBLIC_KEY` | VAPID public key (skips generation if both keys are set) | *(generated into `POSTERN_DATA`)* |
| `POSTERN_VAPID_PRIVATE_KEY` | VAPID private key (skips generation if both keys are set) | *(generated into `POSTERN_DATA`)* |
| `POSTERN_PUSH_SUBSCRIBER` | The VAPID contact (an https URL or `mailto:` email) sent to push services | `https://postern.allmymind.org` |
| `POSTERN_VIEW_FILE` | The encrypted view file `mw postern view` writes, served by `GET /api/view` and watched for `view` events | *(unset: `GET /api/view` answers 404)* |
| `POSTERN_BEAD_CMD` | The command `GET /api/beads/{id}` runs, split on whitespace, the id appended (e.g. `mw postern bead`) | *(unset: 501)* |
| `POSTERN_ON_MESSAGE` | Shell command (`sh -c`) run after records are indexed (e.g. `mw postern inbox --apply`) | *(unset: no hook)* |
| `POSTERN_MAYOR_KEY` | The Mayor's compressed public key, hex (66 characters, `02`/`03` first), answered by `GET /api/me` | *(unset: `""`)* |
| `POSTERN_ISSUER_KEY` | The licence issuer's compressed public key, hex (66 characters, `02`/`03` first); a mint counts only if this key unlocked one of its inputs | *(unset: any mint counts, with a warning)* |
| `POSTERN_COLLECTIONS` | Comma-separated collections a licence mint may name | `postern,spellforge-leaderboard-testnet` |

A malformed `POSTERN_MAYOR_KEY` or `POSTERN_ISSUER_KEY`, or a
`POSTERN_COLLECTIONS` naming no collection, stops the backend at start.

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

The watchdog runs on the VPS with `POSTERN_WATCH_URL=http://10.88.0.3:8787/healthz`
(or the desktop's WireGuard name) and a copy of the desktop's
`postern-vapid.json` and `postern-push-subscriptions.json` in its own
`POSTERN_DATA`; recopy the subscriptions when a device subscribes anew.
