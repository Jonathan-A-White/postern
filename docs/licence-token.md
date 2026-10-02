# A spell-forge License token as a licence for app `spellforge`

The grist door (docs/protocol.md §19) opens for spell-forge when a purchaser's
License token counts as a licence in an app collection that `POSTERN_APPS` maps to
`spellforge`. This page says what makes it count, how the backend finds its holder,
and settles four design points (mw-z361n.1). The rule itself is §16; the code is
`server/internal/licence/licence.go`.

## What counts

A key counts for app `spellforge` when, read from WhatsOnChain testnet:

1. A **mint** transaction carries a typed **M** record (any output; spell-forge puts it
   at output 2) whose JSON payload names `"collection": "spellforge-leaderboard-testnet"`
   and `"holder"`: the key's testnet P2PKH address. Extra payload fields (the gated
   mint's `wrapKey`, `wrap`) are ignored.
2. One of the mint's inputs is unlocked by a P2PKH scriptSig pushing
   `POSTERN_ISSUER_KEY` and spends an output P2PKH to hash160 of that key (since
   mw-gq6.175: the chain's own script check is what proves the signature).
3. The token, the mint's **output 0**, has not been moved away by a typed **TR** record
   in a transaction spending its current outpoint, and the issuer has not revoked it
   (a signed W `{"kind":"revoke","origin":"<mint txid>:0"}` in the issuer's history).
4. `POSTERN_APPS` maps `spellforge-leaderboard-testnet=spellforge`, and that collection
   is not also in `POSTERN_COLLECTIONS`.

spell-forge writes every typed record (M, W, TR) in **six pushes** since mw-jeswf.3:
`'nftgate'`, `0x02`, the type, a 32-byte epoch commitment c(e), an empty value manifest,
the payload. The backend read only four or five until this story, so no gated token
could count; it now reads all three layouts, payload always the last push (§16).

**Finding the holder.** The backend reads the key's address history and the issuer's
(`/confirmed/history` by page plus `/unconfirmed/history`), fetches each transaction's
hex, finds the counting mints, and follows each token from `mint:0` through every
spend of it those histories show: a TR moves it to the address it names, any other
spend (a write) leaves it, and each spend's output 0 is the next outpoint. The mint
must name the key: a key that received a token by transfer is never licensed by it.

## The token slice's mint

The issuer (the Governor's key, on his phone, through Postern's *Issue a licence*)
funds and signs `buildContractMintTransaction` with: `issuerKey` his key (P2PKH
funding inputs, change back to him), `holderPubKey` the **purchaser's device key**,
`holderWrapPubKey` the purchaser's P-256 wrap key, `config.collectionId`
`spellforge-leaderboard-testnet`. Outputs: [0] the License locked to the purchaser,
[1] the Fuel, [2] the 6-push M naming the purchaser's address, [3] the issuer's change.
spell-forge's own `mintContractLicenseToken` self-mints (holder = issuer) and does
**not** count while `POSTERN_ISSUER_KEY` is set. Postern's bundled spell-forge-bsv
(0.1.0) still writes the 5-push, wrap-less M, which spell-forge's gated reading and
transfer refuse: the slice needs a spell-forge-bsv release with gated minting, and
the purchaser's QR must carry the wrap key as well as the device key.

## Design points

Me's own mint (*Mint my licence*) goes to the `postern` collection, not the package's default `spellforge-leaderboard-testnet`; the gate still counts a mint in the old collection until he has re-minted (mw-6ww.63).

**(a) The issuer: one key for every collection.** Keep the one `IssuerKey`, the
Governor's, for `postern` and every app collection; no `POSTERN_APP_ISSUERS`. Why:
only he moves sats and his key stays on his phone (the map's decisions); Postern's
*Issue a licence* already mints in a chosen collection with that key; a second issuer
would be a second key to guard and a second revoke path to read. Add per-app issuers
only when an app needs unattended issuing by a key that is not his.

**(b) Lineage: acceptable on testnet now; the spent-output read closes it.** A write
or TR paid wholly from the Fuel touches no P2PKH address, so it is in no history the
backend reads: the old holder stays licensed after such a transfer, and a TR after
such a write is never reached. On testnet, with a handful of licences the Governor
issues by hand, that is acceptable: a transfer away only ever takes a licence away
(the transferee is never licensed by it), and his Revoke, read from his own history,
always ends one. What closes it: WhatsOnChain now has a spent-output index
(`GET /tx/{txid}/{vout}/spent` answers `{"txid","vin","status"}`, 404 when unspent;
checked live on testnet 2026-09-30, so token-lineage.ts L4-8 is out of date). Follow
the token hop by hop with it: one read per hop per licence per cache refresh. Its own
story, before mainnet or before transfers are offered to purchasers; this one adds no
chain read.

**(c) Output 0: trust the issuer's signature on the M; do not check the covenant.**
The issuer's SIGHASH_ALL signature commits to every output, so output 0 is what his
own builder made; recognising the License covenant would tie the Go backend to one
compiled artifact's bytes and break at every artifact version. A mint whose output 0
is not a License only lets its holder keep a licence through spends without a TR,
which the issuer's Revoke ends. Until mw-gq6.175 the backend looked only for a
scriptSig *pushing* the issuer's key, so a transaction spending a non-P2PKH output
(say `OP_2DROP OP_1`) with `<junk> <issuer key>`, paying 1 sat to the issuer's
address, would have passed as issued, for `postern` too. Now the input pushing the
key must also spend an output P2PKH to hash160(issuer key), read from the histories
already fetched or by one read of the spent transaction per candidate mint or
revoke, so the chain's own script check proves the signature.

**(d) The 5-minute cache: fine for grist.** A revoke or transfer takes up to
`licenceCacheTTL` (5 min) to close the door, and up to an hour longer (the checker's
stale grace) while WhatsOnChain cannot be reached. Grist is a request to the mill, not
money or the cockpit, and every walk reads two full address histories at WhatsOnChain's
rate limit; a shorter TTL buys little. Keep it.
