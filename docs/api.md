# Postern backend API

The contract the PWA and `mw` build against. Implemented in `server/internal/api`,
backed by one WhatsOnChain poller (`server/internal/poller`) indexing the postern
anchor address into an append-only store (`server/internal/index`).

The backend binds `127.0.0.1` by default (`POSTERN_ADDR`); the VPS reaches it over
WireGuard through an nginx proxy, not directly. Nothing here requires auth at this
layer — that's the proxy's job.

Every error response, from every endpoint below, is:

```json
{ "error": "<message>" }
```

## GET /healthz

Liveness check.

- `200 text/plain` — body `ok`.

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
        "payload": { "kind": "msg", "ciphertext": "base64...", "ts": "2026-09-24T12:00:00.000Z" }
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
  - `payload` — the record's version-1 payload, re-parsed as JSON, if the
    record was version 1 and its payload parsed as JSON. Omitted for any other
    record (a different version, or a version-1 payload that didn't parse).
    The backend never decrypts a `ciphertext` field or any other content
    inside `payload` — it's stored and returned exactly as found on chain.
  - `next` — the current index head sequence number. Pass this back as
    `since` on the next call to page forward; when `next` stops advancing,
    the client has caught up.
- `400` — `since` isn't a valid non-negative integer.

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

## Configuration (environment)

| Variable | Meaning | Default |
|---|---|---|
| `POSTERN_ADDR` | Address the HTTP server binds | `127.0.0.1:8787` |
| `POSTERN_NETWORK` | Network label (informational; doesn't affect request URLs) | `testnet` |
| `POSTERN_ANCHOR` | The anchor address the poller watches | *(required, no default)* |
| `POSTERN_WOC_BASE` | WhatsOnChain API base URL | `https://api.whatsonchain.com/v1/bsv/test` |
| `POSTERN_DATA` | Directory holding the index (`postern-index.jsonl`) | `./data` |

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
