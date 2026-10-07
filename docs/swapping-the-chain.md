# Swapping the chain, or running with none

You are building a Postern-like app and want a different chain, or no chain at all. This page
says where the two seams are, what each method must do, which files sit behind them, and the
steps. It describes the code as it is. For the reasoning, see
[best-practices.md](best-practices.md) parts 4 and 5.

## 1. What "the chain" is here

In Postern the chain is four things, all optional:

- **A second road for a post.** With the backend unreachable, the phone puts a typed post on
  chain and reads the anchor address itself ([protocol.md](protocol.md) §4, §21).
- **Licences.** A key may use the backend only while the chain holds a licence for it.
- **Stamps.** A landing can leave a commitment on chain that the work item's page checks.
- **The anchor.** The address the poller reads, and where the index's hash chain can be anchored.

**Not the chain, and it stays whatever you do:** the key on the phone and its daily unlock, the
signed challenge on every call, the sealing of every record, the outbox, the stream and the poll,
direct delivery. `@bsv/sdk` is used for those as a crypto library; it touches no chain there.

There are two seams, one per side. Each is one door: everything else reaches the chain through it.

## 2. The backend seam

The package is [server/internal/chain/chain.go](../server/internal/chain/chain.go). It imports no
implementation. `chain.Chain` is composed of three smaller interfaces so a caller can ask for
only what it needs: the poller and the licence walk take a `chain.Reader`, the coin routes take a
`chain.Chain`.

| Method | What a caller relies on |
|---|---|
| `GetHistory(address)` | An address's transactions, oldest first, with `Height` 0 for unconfirmed. An empty list and no error means "nothing there". |
| `GetTransactionHex(txid)` | The raw transaction in hex, always the same for the same txid (the licence walk caches it on disk). |
| `Broadcast(rawTxHex)` | Sends the transaction and returns its txid; a refusal comes back as a `*chain.ProviderError`. |
| `GetUtxos(address)` | The address's unspent outputs (`TxHash`, `TxPos`, `Value` in satoshis, `Height`). |
| `GetBalance(address)` | `chain.Balance`: confirmed and unconfirmed satoshis. |

Any error is answered to the phone as `502` carrying its message; a `*chain.ProviderError`
names the provider, its status and its body ([api.md](api.md) has the routes).

**Where the implementation is chosen:** one function, `newChain` in
[server/cmd/postern/main.go](../server/cmd/postern/main.go). It returns a `chain.Chain`, today
`woc.NewClient(cfg.WocBase)`. Nothing else in the backend names the implementation.

## 3. The app seam

The door is [src/chain.ts](../src/chain.ts). `deliver` and `live` send and read through the
exported `chain`; the Key screen and the bead page do too. `setChain(next)` plugs another
implementation in and returns the one it replaced (tests use it).

| Member of `Chain` | What a caller relies on |
|---|---|
| `sendText` | Encrypts, signs and sends one text record and resolves with its id; on failure it throws a readable error and sends nothing. |
| `read` | The records new to this phone since those already `seen`; throws when the chain cannot be reached. |
| `pollMs` | How long the chain poll waits before its first read, in ms. |
| `nextDelay` | The next wait, given the last wait, whether the read was clean and whether it found anything. |
| `addressFor` | The address a licence locked to a public key shows, and is funded at. |
| `checkLicence` | Looks for a key's licence; throws when the chain cannot be reached. |
| `cachedLicenceStatus` | The status the last check left, or `undefined`. |
| `mintPending` | The mint this phone broadcast that the chain has not shown yet (`{ txid, broadcastAt }`), or `undefined`. |
| `balance` | A key's balance in satoshis; throws when the chain cannot be reached. |
| `mintCost` | What a balance must reach before a licence can be minted. |
| `mint` | Mints the key's own licence; throws a readable error and sends nothing when it cannot. |
| `issueCost` | What issuing a licence to someone else costs. |
| `issuerBalance` | The issuer's spendable balance in satoshis. |
| `issueLicence` | Mints a licence to a holder's key, funded by the issuer. |
| `revokeLicence` | Ends a licence this key issued. |
| `issuedLicences` | The licences this key issued, with whether each is revoked. |
| `verifyStamp` | Whether a stamp checks out for a rig and commit; never throws. |
| `explorerUrl` | A link to a transaction on a block explorer. |
| `screens` | The chain-only components: `StampSection`, `LicenceExplainer`, `IssueLicences`. Any left out is simply not drawn. |

**The lint rule keeps the door single.** [eslint.config.js](../eslint.config.js) lists the chain
modules (`CHAIN_MODULES`) and the chain components (`CHAIN_COMPONENTS`) and refuses
`no-restricted-imports` of any of them from every other file under `src/`. Reach the chain only
through `src/chain.ts`, and add a new chain module to those two lists.

## 4. The chain files

**Backend**

- [server/internal/chain/chain.go](../server/internal/chain/chain.go): the interfaces and value types.
- [server/internal/woc/client.go](../server/internal/woc/client.go): the one implementation (WhatsOnChain).
- [server/cmd/postern/main.go](../server/cmd/postern/main.go): `newChain`, the one place it is chosen.
- [server/internal/config/config.go](../server/internal/config/config.go): `POSTERN_WOC_BASE` and `POSTERN_ANCHOR`.

Callers, which use the interfaces and need no change: the coin routes in
[server/internal/api/handlers.go](../server/internal/api/handlers.go),
[server/internal/poller/poller.go](../server/internal/poller/poller.go) and
[server/internal/licence/licence.go](../server/internal/licence/licence.go).

**App**

- [src/chain.ts](../src/chain.ts): the door.
- [src/services/send.ts](../src/services/send.ts), [spendable.ts](../src/services/spendable.ts),
  [chainRead.ts](../src/services/chainRead.ts), [whatsonchain.ts](../src/services/whatsonchain.ts),
  [confirmedHistory.ts](../src/services/confirmedHistory.ts), [stamp.ts](../src/services/stamp.ts),
  [licence.ts](../src/services/licence.ts), [mint.ts](../src/services/mint.ts),
  [issue.ts](../src/services/issue.ts): the BSV implementation.
- [src/data/repositories/pending-spends-repo.ts](../src/data/repositories/pending-spends-repo.ts): the coins already spent but not yet seen by the provider.
- [src/key/IssueLicences.tsx](../src/key/IssueLicences.tsx),
  [src/licence/LicenceExplainer.tsx](../src/licence/LicenceExplainer.tsx),
  [src/cockpit/StampSection.tsx](../src/cockpit/StampSection.tsx): the chain-only components.

Callers of the door: [src/services/deliver.ts](../src/services/deliver.ts),
[src/services/live.ts](../src/services/live.ts), [src/key/KeyVault.tsx](../src/key/KeyVault.tsx)
and [src/cockpit/BeadScreen.tsx](../src/cockpit/BeadScreen.tsx).

## 5. Another chain

**Backend**

1. Write a package that satisfies `chain.Chain`, the way `internal/woc` does. Add
   `var _ chain.Chain = (*Client)(nil)` so the compiler checks it.
2. Return it from `newChain` in `server/cmd/postern/main.go`. Add any configuration it needs to `server/internal/config/config.go`.
3. Keep the value types in `internal/chain`; translate your provider's shapes to them inside your
   package, as `server/internal/woc/client.go` does, and return `*chain.ProviderError` for a refusal.
4. Test the routes against a fake first:
   [server/internal/api/chain_fake_test.go](../server/internal/api/chain_fake_test.go) (the coin
   routes) and [server/internal/poller/chain_fake_test.go](../server/internal/poller/chain_fake_test.go)
   (the poller) are worked examples of a `Chain` with no provider behind it.
5. Run `go vet` with the tests, then `cd server && go build ./... && go test ./...`.

**App**

1. Build a `Chain` object (see the table in part 3) from your own modules, put them with the
   chain files, and add their names to `CHAIN_MODULES` or `CHAIN_COMPONENTS` in `eslint.config.js`.
2. Make it the `bsv` default in `src/chain.ts`, or hand it to `setChain` at start-up.
3. Test with a fake first. [tests/unit/chain-door.test.ts](../tests/unit/chain-door.test.ts) spreads the
   current chain and overrides `sendText`; [tests/unit/chain-door-screens.test.tsx](../tests/unit/chain-door-screens.test.tsx)
   shows the Key screen and bead page with `screens: {}`. [tests/support/fake-chain-provider.ts](../tests/support/fake-chain-provider.ts)
   stands in for the provider under the BSV implementation.
4. The record bytes must be the same on every road ([best-practices.md](best-practices.md) part 4),
   so the reader on the backend and the reader on the phone agree on one framing.
5. Run `npm ci && TZ=UTC npm test && npm run typecheck && npm run lint`.

Change both sides together: the phone writes where the backend's poller reads.

## 6. No chain

**Backend.** Write a `chain.Chain` that answers as an empty chain and hand it to `newChain`:

| Method | Answer |
|---|---|
| `GetHistory` | An empty list and no error. The poller then indexes nothing; direct delivery is the only way in. |
| `GetTransactionHex` | An error; nothing asks for a transaction once the history is empty. |
| `Broadcast` | A `*chain.ProviderError` saying there is no chain; the route answers `502` with that text. |
| `GetUtxos` | An empty list. |
| `GetBalance` | The zero `chain.Balance`. |

**Who may use the backend must come from somewhere else.** With the BSV chain, a key is allowed
while the chain holds a licence for it. An empty chain holds none, so with `newChain` alone every
key is refused with `401`, but the two keys configuration names (`POSTERN_MAYOR_KEY` and
`POSTERN_MILL_KEY`, [server/internal/api/rights.go](../server/internal/api/rights.go)), which
need no licence. Postern ships no other list of allowed keys. The place one would plug
in is `auth.LicenceChecker`
([server/internal/auth/checker.go](../server/internal/auth/checker.go)): one method,
`Held(pubKeyHex) (bool, error)`. Write one that reads your own list, and pass it to `api.NewHandler`
where `newApp` in `server/cmd/postern/main.go` passes the cached licence checker today. A checker that also has
`HeldCollections` (`auth.CollectionChecker`) says what each key may do; without it every held key
is a cockpit key.

**App.** Plug in a `Chain` whose `screens` is `{}` and whose methods answer:

| Member | Answer |
|---|---|
| `sendText` | Throws a readable error ("no second road"), sending nothing. |
| `read` | Throws; the live state then never shows "live from the chain". |
| `pollMs`, `nextDelay` | Any numbers; with `read` throwing, the wait only grows. |
| `checkLicence`, `balance`, `mint`, `issue*`, `revokeLicence`, `issuerBalance` | Throw, or answer "not held" and zero. |
| `cachedLicenceStatus`, `mintPending` | `undefined`. |
| `verifyStamp` | A result that says the stamp could not be checked. |
| `screens` | `{}`. |

**What the user then sees.**

- **No second road.** While the backend is down, a post stays in the outbox and goes when it is
  back; nothing reaches the agent meanwhile, and nothing comes from the agent.
- **No Stamp section** on the bead page, and no Licence explainer or Issue licences block on the
  Key screen.
- **The Key screen** still shows its address, balance and mint blocks from the answers above,
  so a no-chain app should edit those blocks in [src/key/KeyVault.tsx](../src/key/KeyVault.tsx)
  rather than rely on empty answers.

If you also want to drop the code, remove the chain files in part 4 and the lines naming them in
`eslint.config.js`, and see [best-practices.md](best-practices.md) part 5 for the rest.
