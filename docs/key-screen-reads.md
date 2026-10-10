# What the Key screen asks WhatsOnChain (mw-nlxylg)

The phone reads WhatsOnChain (testnet) itself, unauthenticated, from the Key screen. Its free
tier answers about 3 requests a second per IP and then 429s, and a 429 carries no CORS header,
so the browser reports it as a failed fetch: "Could not reach WhatsOnChain after 3 tries
(offline, or rate-limited...)". On 2026-10-07 the Key screen's Issued licences hit this and a
Retry did not help. This page counts what one open of the Key screen asks, before and after the
fix, and names the test that pins it.

## The reads

One open of the Key screen (`src/key/KeyVault.tsx`, unlocked) starts three reads together:

| Read | Where | Asks |
|---|---|---|
| The balance line | `chain.balance` → `fetchBalanceSatoshis` (mint.ts) | `/address/<a>/unspent`, once |
| The licence check | `chain.checkLicence` → `findLicence` (licence.ts), only when the cached status is not "held in postern" | `/address/<a>/confirmed/history` once per page, `/unconfirmed/history` once, `/tx/<txid>/hex` for **every** transaction in the history |
| Issued licences | `chain.issuedLicences` → `issuedLicences` (issue.ts), once the key has collections | the same again |

The issuer's own coins (`issuerBalance`) and the collections (`/api/me`) go to the backend, not
WhatsOnChain.

Let **P** be the pages of confirmed history (100 transactions a page) and **T** the transactions
in the key's whole history (every one the key signed or was paid in: its messages and records too).

## Before

`1 + 2 × (P + 1) + 2 × T` requests when the licence check runs, `1 + (P + 1) + T` when the cache
already holds a postern licence. A key with 100 transactions made 205 requests; one with 5, 15.
The two walks ran side by side, each from its own provider (the library spaces only the calls of
one provider, 350 ms apart), and the history pages were a raw `fetch` with no spacing at all: so
the rate was about 2 × 2.9 requests a second, twice what the free tier allows. A failed walk threw
away what it had read, so Retry started over.

## After

`1 + (P + 1) + T` at most, whichever way the screen opens, and each is asked for once:

- **Every request waits its turn in one queue**, 350 ms between starts (`src/services/chainPacer.ts`),
  the history pages and the balance included: about 2.9 requests a second whichever read asks.
- **A transaction's hex is read once for the page's life** (`src/services/sharedChainReads.ts`):
  a txid names one set of bytes for ever, so the licence check and the Issued licences list share
  it. It lives in memory only (nothing stored, no schema). A read that fails is dropped from it,
  so Retry asks again for that transaction and the ones not yet read, not for all of them.
- **An address list asked while the same list is on its way** is answered by that request, so the
  two walks make one set of page calls between them. Lists are never kept past their answer: a
  new mint or revoke shows up the next time the screen opens.

So a Key screen open makes at most **1 + P + 1 + T** requests, **N = 8 for a key with 5
transactions** on one page (15 before), and opening the screen again in the same page life makes
1 + 1 + 1 = 3 (the coins and the two lists; no transaction again).

What this does not do: a key with a long history still makes T requests the first time, at about
2.9 a second, so 300 transactions take about two minutes. Serving the reads through the backend
(a new endpoint) would take the phone off WhatsOnChain altogether; that is a feature held for the
Governor.

## Issuing a burst (mw-i7cwnn)

Issuing licences back to back still tripped the limit on 2026-10-09: three issued in a row, then
"The issued licences could not be read". Two causes, both fixed:

- **The mint builder read through a provider of its own.** `issueLicence` (issue.ts) handed
  spell-forge-bsv's builder a fresh `createChainProvider()`, which reads the source transaction of
  every coin it is given outside the queue, beside the list the previous issue had just started.
  It now reads through `sharedChainReads()` like everything else. The queue also waits again when a
  timer fires a hair early, so two starts are never closer than the gap.
- **A failed re-read threw away the rows.** After an issue the list is read again; if that failed the
  red error replaced rows the phone already knew (the licences just issued, or the list read
  before). Now the rows stay, a quiet "Reading again…" line shows, and the list is read again by
  itself after 2, 4, 8, 16 and 32 s; only when nothing is known, or five reads in a row fail, does the
  red error and Retry show.

## Pinned by

- `tests/unit/issue-burst.test.tsx` and `features/issue-burst.feature`: three licences issued in a
  row against a `fetch` that refuses two requests under 350 ms apart or more than 3 in a second
  (`tests/support/woc-stub.ts` `rateLimit`) end as three held rows with no error; and a list that
  cannot be read for three seconds keeps the new row and recovers by itself.

- `tests/unit/key-screen-reads.test.ts` and `features/key-screen-reads.feature`: the three reads
  made together over a `fetch` that records every request (`tests/support/woc-stub.ts`) count
  8 for 5 transactions and 11 for 6 over three pages, ask nothing twice, ask for no transaction a
  second time on a second open, ask again only for the one that failed, and are spaced.
