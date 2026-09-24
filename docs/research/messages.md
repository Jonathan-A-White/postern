# Research: how a message travels on-chain between the Governor and the Mayor

Answers mw-f758y.3. Everything measured below was run against SpellForge's `src/bsv`
(`@bsv/sdk` 2.2.0, the BSV library this app is meant to share, not fork) and against
SpellForge's own testnet measurements in `src/bsv/contracts/SIZES.md`. Nothing in this
rig changed: postern has no `@bsv/sdk` dependency yet, and this doc recommends what to
add when a prototype ticket picks this up.

## Recommendation, up front

- **Envelope**: BRC-78 `EncryptedMessage` (`@bsv/sdk`'s `messages/EncryptedMessage`) —
  ephemeral-invoice ECDH on secp256k1 + AES-256-GCM, sender-authenticated by
  construction. Fixed 150-byte overhead, measured. Do not build a bespoke ECDH+AES
  construction; the SDK already ships one and this app already depends on the SDK
  family.
- **Text and small payloads**: the ciphertext travels inline, base64'd inside a new
  `kind: 'msg'` JSON payload under nftgate record **version 1** (the plaintext/JSON
  envelope `src/bsv/record.ts` already defines) — not version 2 (the typed,
  License-contract format). A text message costs low single-digit satoshis at today's
  observed fee floor; a fraction of a US cent.
- **Photo and voice**: off-chain. The Go backend on the desktop serves the encrypted
  blob over the OpenVPN tunnel (mw-f758y's already-decided network); the on-chain
  record carries only a hash, size, and mime type. Putting a 1 MB blob directly
  on-chain is technically affordable (≈1,000–100,000 sat depending on fee policy,
  still well under a cent to a few cents) but wrong for this app: it makes every
  scanning client (the Governor's phone especially) download megabytes from
  WhatsOnChain on every poll, and ties message delivery to block confirmation instead
  of the VPN, which is already faster and already free.
- **Discovery**: one dedicated anchor address for this channel (not SpellForge's
  leaderboard anchor), watched by the **Go backend**, not by each client independently.
  The backend already needs to watch the chain to drive the epic's planned Web Push
  notifications; a second poller on the phone would double the WhatsOnChain request
  rate against the same 3 req/s ceiling for no benefit, and a PWA cannot poll reliably
  in the background anyway.
- **Library**: reuse only `record.ts`'s low-level script framing —
  `encodeRecordScript` / `decodeRecordScript` / `findRecordsInTransaction`, which just
  read the `OP_FALSE OP_RETURN 'nftgate' <version> <payload>` pushes. Do **not** reuse
  `decodeRecordPayload` or the version-2 typed format — those are License-contract
  specific (mint/write/transfer of a License NFT) and message payloads are a different
  application of the same protocol prefix. This is the shape of "not forking the
  library": postern needs one new JSON `kind` at the low-level layer, nothing else.

## 1. The encrypted envelope

`@bsv/sdk` ships `messages/EncryptedMessage.ts`, implementing BRC-78:

```
encrypt(message, senderPrivateKey, recipientPublicKey) -> bytes
decrypt(message, recipientPrivateKey) -> bytes
```

Construction (read from the SDK source, `node_modules/@bsv/sdk/src/messages/EncryptedMessage.ts`):

1. A random 32-byte `keyID` is generated per message.
2. Sender and recipient each derive a one-off keypair via BRC-42 child-key derivation,
   invoice number `2-message encryption-<base64 keyID>`.
3. ECDH on those derived keys produces a shared secret; its x-coordinate becomes an
   AES-256-GCM `SymmetricKey`.
4. The output is `version(4B) || senderPubKey(33B compressed) || recipientPubKey(33B
   compressed) || keyID(32B) || AES-GCM(iv 32B || ciphertext || tag 16B)`.

Measured (`node measure-encrypt.mjs` against the real SDK, roundtripped through
`decrypt` to confirm correctness):

| Plaintext | Encrypted | Overhead |
|-----------|----------:|---------:|
| 0 B | 150 B | 150 B |
| 20 B | 170 B | 150 B |
| 280 B | 430 B | 150 B |
| 2,000 B | 2,150 B | 150 B |

The 150 B overhead is fixed regardless of message size (header 4+33+33+32=102 B, plus
AES-GCM's own 32 B IV + 16 B tag = 48 B).

**Sender authentication is implicit, not a separate signature.** Decryption only
succeeds if the AES-GCM tag verifies, which requires the same shared secret on both
sides — and that shared secret can only be reproduced by whoever holds the private key
matching the `senderPubKey` embedded in the envelope (assuming the recipient's own key
is uncompromised). So "signed by the sender" in the research question is satisfied by
the ECDH construction itself; no separate BRC-77 `SignedMessage` step is needed purely
for authenticity between the two parties.

**What this does *not* give you** (the SDK's own doc comment, verbatim, is worth
keeping in mind): no forward secrecy, no replay protection, no third-party-verifiable
signature. That's fine for a two-party channel between keys that already trust each
other, which is what postern is. It is **not** fine for the epic's separate "provably
edited only by him" charter-approval mechanism (mw-f758y's "Not yet specified" list) —
that wants a verifiable, possibly third-party-checkable signature (BRC-77
`SignedMessage`, ~70–100 B for an ECDSA signature plus pubkey), not confidentiality.
Keep those two mechanisms distinct; this research only covers the message channel.

## 2. How text travels on-chain

`src/bsv/record.ts` already defines the wire format postern should reuse as-is:

```
OP_FALSE OP_RETURN <push 'nftgate'> <push version-byte> <push payload>
```

`encodeRecordScript` / `decodeRecordScript` build and parse exactly this (three
pushes, protocol id `nftgate`, one-byte version, opaque payload). Version 1's payload
is UTF-8 JSON with a `kind` discriminator; today it understands undecorated `{text,
ts}`, plus `mint`/`transfer`/`write` for the License NFT app. Postern's message kind
slots into the same envelope:

```json
{ "kind": "msg", "ciphertext": "<base64 of EncryptedMessage.encrypt output>", "ts": "2026-09-24T12:00:00.000Z" }
```

This is a **new kind added to postern's own decoder**, not a change to
`decodeRecordPayload` in the shared library (that function is License-app-specific and
out of postern's business to extend). Postern only needs the low-level
`encodeRecordScript` / `decodeRecordScript` / `findRecordsInTransaction` primitives,
which don't know or care what's inside the payload push.

Do **not** use format 0x02 (`RECORD_VERSION_TYPED`, the `M`/`W`/`TR` record types).
That format exists to be read by the on-chain **License contract's script** — it
carries a value manifest and is only ever built by a transaction that also spends a
License token and a Fuel(C) UTXO through ~13 KB of sCrypt-compiled unlocking script
(`SIZES.md`). A message between the Governor and the Mayor has no License/Fuel
contract in the picture at all; it's a plain P2PKH-funded transaction, the same shape
`write-record.ts` already builds for version-1 records today.

### Measured cost (a plain P2PKH-funded record tx, testnet, today's config)

Built with the same shape `buildRecordTransaction` in `write-record.ts` already
produces — one P2PKH input, output 0 the record (0 sat), output 1 a 1-sat anchor
payment, output 2 P2PKH change — but with the payload replaced by an encrypted
message. Measured with `@bsv/sdk` directly (`node measure-record.mjs`), fee computed
by `SatoshisPerKilobyte`, the same fee model `write-record.ts` uses:

| Message | Plaintext | Ciphertext (payload) | Tx size | Fee @ 1 sat/kB (today's `chainConfig`) | Fee @ 100 sat/kB | Fee @ 500 sat/kB |
|---|--:|--:|--:|--:|--:|--:|
| Short reply ("yes"/"no") | 20 B | ≈205 B (150 B envelope + JSON wrapping) | 311 B | 1 sat | 32 sat | 156 sat |
| Typical text (280 chars) | 280 B | ≈465 B | 574 B | 1 sat | 58 sat | 287 sat |
| Long text (2,000 chars) | 2,000 B | ≈2,185 B | 2,295 B | 3 sat | 230 sat | 1,148 sat |

At today's BSV price (~$19, 2026-09-24, volatile — see Sources) even the worst case
here (1,148 sat at a 500 sat/kB policy) is **≈$0.0002**. This app's own testnet
`chainConfig.feeRateSatPerKb` is 1, and SpellForge's real broadcast measurements
(`SIZES.md`, "Real testnet transactions with Fuel(C)") confirm miners are actually
accepting ~1 sat/kB in practice on testnet today, well under GorillaPool's posted
policy of 100 sat/kB as of 2026-09-17 (the spec's own comparison point) — **there is a
real gap between posted fee policy and what gets accepted**, worth re-checking live
immediately before mainnet rather than trusting either number blind.

The 1-sat anchor payment (below) is the only per-message cost that doesn't come back
as change; everything else funds miner fee or returns to the sender's own wallet.

## 3. How a photo, screenshot, or voice note travels

The epic notes name two candidates; this research settles it.

**Measured: embedding a 1 MB blob directly in the record's OP_RETURN push** (same
transaction shape as above, one P2PKH input, payload = 1 MB of ciphertext):

| | Size | Fee @ 1 sat/kB | Fee @ 100 sat/kB | Fee @ 500 sat/kB |
|---|--:|--:|--:|--:|
| 1 MB blob, inline | 1,048,831 B tx | 1,049 sat (≈$0.0002) | 104,884 sat (≈$0.02) | 524,416 sat (≈$0.10) |

There's no protocol-level chunking limit forcing multiple OP_RETURN outputs — BSV
has no block-size cap that would matter here, and SpellForge's own spec already
verified a single broadcaster accepts pushes far larger than this (`WRAP_MAX` 1 MB,
"below the observed broadcaster limit of 100 MB (GorillaPool)"). So "carried in
chunked data outputs" would be a self-imposed complexity, not a chain requirement.

**Recommendation: don't inline it anyway.** Even though the satoshi cost is trivial,
inlining large attachments on-chain is the wrong design for this app specifically:

- **Every scanning client re-downloads it.** `scanRecords` (`src/bsv/scan-records.ts`)
  fetches the full transaction hex per history entry — a 1 MB photo becomes a 1 MB
  `GET /tx/{txid}/hex` on WhatsOnChain, against a 3 req/s rate limit shared with every
  other read this app makes, every time the Go backend polls the anchor address and
  every time the Governor's phone catches up after being offline.
- **It couples message delivery to block confirmation.** The Governor and Mayor
  already have a private, always-on channel — the OpenVPN link to the desktop — which
  is faster and has no size-driven cost at all. Chain confirmation (minutes) gates
  nothing about actually *reading* the photo if it's fetched over the VPN instead.
- **It's permanent and public** (even encrypted): a leaked key years later decrypts
  everything ever inlined. A hash reveals nothing.

Instead: encrypt the blob with the **same per-message symmetric key** BRC-78 already
derives (its `keyID` is already carried in the envelope, so no separate key-wrapping
step is needed), store the encrypted blob on the desktop, and serve it from the Go
backend over the VPN (`server/cmd/postern` already exists as the place for this — it's
the same host the epic already assigns the Go backend to). The on-chain record carries
a hash, not the bytes:

```json
{ "kind": "attachment", "mime": "image/jpeg", "size": 812043,
  "sha256": "<hex of the encrypted blob>", "keyID": "<base64, from the BRC-78 envelope>",
  "ts": "2026-09-24T12:00:00.000Z" }
```

This keeps every on-chain write the same small, ~constant cost as a text message
(a few hundred bytes) regardless of attachment size, and the hash lets the receiving
side verify the blob it fetched over the VPN wasn't tampered with before attempting to
decrypt it.

## 4. How each side discovers new messages

`src/bsv/scan-records.ts` and `whatsonchain-provider.ts` already establish the pattern
this app should follow, not reinvent: WhatsOnChain has no way to search OP_RETURN
contents, so every write also pays a minimal (1 sat) output to a shared **anchor
address**, and discovery means walking that address's `/address/{addr}/history` (plus
`/unconfirmed/history` for the mempool) and reading each transaction found there.

Two open sub-questions this settles:

**Whose anchor address?** A channel-specific address, not SpellForge's leaderboard
anchor (`chainConfig.anchorAddress` today) — reusing that anchor would mix postern's
message traffic into an unrelated scan and vice versa. The simplest option is one
configured address, the same way `chainConfig.anchorAddress` works today (a value both
the Go backend and the PWA are given, no on-chain setup transaction required — it
never needs its own private key since nothing ever spends *from* it). A dust balance
just accumulates there over time; that's fine, it's 1 sat per message.

**Who polls it?** The **Go backend**, not each client independently:

- WhatsOnChain rate-limits at 3 req/s per IP (`whatsonchain-provider.ts`'s own
  `MIN_REQUEST_SPACING_MS = 350`, chosen from an observed live rate limit). Two
  independent pollers (phone + backend) burn that budget twice for the same data.
- A PWA cannot reliably poll in the background on Android without a live service
  worker + periodic background sync, which is unreliable and battery-constrained; a
  server-side poller has no such limit.
- The epic already commits to Web Push notifications driven by the Go backend
  ("Notifications... Web Push (VAPID) from the Go backend," mw-f758y's notes). A
  chain-watching poller on the backend is the same piece of infrastructure that
  notification feature needs — build it once, use it for both "new message arrived"
  and "wake the Mayor."
- The backend can hold a durable "last seen txid/height" cursor so a restart doesn't
  re-scan full history; a phone-side scan has to do the equivalent from IndexedDB
  anyway, so centralizing it removes a duplicate implementation, not just duplicate
  requests.

The phone then reads *from the backend* (over the VPN, a small REST/websocket surface
next to `/healthz`) rather than from WhatsOnChain directly — the backend is a cache +
index in front of chain data, exactly what `scanRecords`' own comment calls itself
today: "phase 1's stand-in for an overlay indexer." A later overlay indexer (or a
self-run BSV node) can replace WhatsOnChain as the backend's data source without any
client-facing change, since nothing in `scan-records.ts`/`chain-provider.ts` names
WhatsOnChain in its interface.

## 5. Sources

- [Bitcoin SV price today, BSV to USD live price](https://www.coinmarketcap.com/currencies/bitcoin-sv/) — CoinMarketCap, ~$19–21 on 2026-09-24 (cross-checked against CoinGecko $21.10, Bitget $17.47; used $19 as a round mid estimate — re-check before quoting a customer-facing figure)
- `src/bsv/record.ts`, `write-record.ts`, `scan-records.ts`, `whatsonchain-provider.ts`, `config.ts` — SpellForge, this rig's sibling, the library this app is meant to share
- `src/bsv/contracts/SIZES.md` — SpellForge's own measured testnet transaction sizes and fees, including real broadcast fee-vs-policy gap
- `docs/bsv-nft-gated-app-spec.md` — SpellForge's License/Fuel contract spec, for what the typed 0x02 record format is actually for and why it doesn't fit messages
- `node_modules/@bsv/sdk/src/messages/EncryptedMessage.ts`, `SymmetricKey.ts` — BRC-78 implementation read directly, `@bsv/sdk` 2.2.0

## 6. Open questions for a prototype ticket

- Exact JSON shape for `kind: 'msg'` and `kind: 'attachment'` payloads (draft above,
  not finalized) — including whether `ts` should be signed/committed some other way
  to resist a malicious relay reordering messages, given BRC-78 gives no replay
  protection.
- Anchor address provisioning: a bare configured value (this doc's recommendation) vs.
  a deterministically-derived address from both parties' known public keys (no
  out-of-band exchange needed, but adds a derivation step neither side needs today
  since config is already shared via this repo).
- The Go backend's REST/websocket surface for "list messages since cursor X" and
  "fetch attachment blob by hash" — not designed here, follows from mw-f758y's "The
  Mayor's side" and "Hosting the PWA" open items.
- Whether `@bsv/sdk` becomes a postern dependency directly (git subtree of
  SpellForge's `src/bsv`, a published package, or an extracted library rig) is
  mw-f758y's separate "Sharing the BSV library" open item — this doc assumes whichever
  answer wins still exposes `record.ts`'s low-level script encode/decode functions
  unchanged.
