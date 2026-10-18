# postern backend

The Go backend behind https://postern.allmymind.org. Configuration is in
`internal/config`; the wire contract is `../docs/api.md` and
`../docs/protocol.md`. This file documents the saved-prompts routes; the Ideas only routes are in
`../docs/api.md` and `../docs/protocol.md` §25.

## Self-registration (Lampas)

A stranger proves an email and a phone with Twilio Verify and the backend keeps
who they are as keyed fingerprints only (HMAC-SHA256, key in
`postern-register.key` under `POSTERN_DATA`, made the first time). The people
are `register-people.json` in `POSTERN_DATA`: per person a fingerprint of each
email and of the phone, up to 3 device keys, a daily limit (50), no address.
Each email and each phone belongs to one person; a new email with a phone
already registered is a new device joining that person. The raw email and phone
are never written to disk or the log (a pending registration holds them in memory
for at most 10 minutes, because Twilio's check needs them again).

Environment:

| Name | Meaning |
|---|---|
| `POSTERN_TWILIO_ACCOUNT_SID` | the Twilio account SID |
| `POSTERN_TWILIO_AUTH_TOKEN` | the Twilio auth token |
| `POSTERN_TWILIO_VERIFY_SID` | the Verify service SID (email and SMS channels enabled) |
| `POSTERN_REGISTER_STARTS_PER_HOUR` | starts one IP may make an hour (default 10) |
| `POSTERN_REGISTER_CONFIRMS_PER_HOUR` | confirms one IP may make an hour (default 30) |
| `POSTERN_REGISTER_SENDS_PER_HOUR` | starts all callers together may make an hour (default 30). Each start has Twilio send one SMS and one email, so this caps what SMS can cost in an hour, whatever the IPs |
| `POSTERN_REGISTER_IP_HEADER` | the header the proxy sets to the caller's address, for the limits (nginx: `proxy_set_header X-Real-IP $remote_addr;` and `X-Real-IP`); unset counts the connection's own address, which behind nginx is every caller at once, and with Twilio set the backend logs one `warning: POSTERN_REGISTER_IP_HEADER is not set` line at start |
| `POSTERN_SITE_ISSUER_KEY` | the site issuer's private key, a testnet WIF: it signs the Lampas licence each confirmed device gets, and revokes it when the device is removed. A key of its own, never the Governor's issuer (`POSTERN_ISSUER_KEY`, which the backend refuses here) |

**Limits on what a start may cost.** Every start sends an SMS, and SMS costs
money, so an IP's limit is not enough: callers on many IPs could have codes sent
to one paid number again and again, or to many (SMS pumping). Besides the per-IP
limits above, one email and one phone may each have codes sent at most 3 times an
hour and 10 times a day (fixed, counted by the address's keyed fingerprint, never
the address), and all callers together at most `POSTERN_REGISTER_SENDS_PER_HOUR`
starts an hour. A start over any of them is `429` and nothing is sent; the first
start the hourly cap refuses logs one line,
`register: the send cap of <n> starts an hour (POSTERN_REGISTER_SENDS_PER_HOUR) is reached`,
with no address, and the next start it allows lets it say so again. Twilio
Verify's own fraud guard is welcome too but is not counted on.

With any of the three Twilio names missing, registration is closed: start and
confirm answer `503 {"error":"registration closed"}` and nothing else changes.
With Twilio set but `POSTERN_SITE_ISSUER_KEY` not, start and confirm answer
`503 {"error":"licensed by hand: ask the Governor"}` (no code is sent), and
nothing else changes. A key that is not a testnet WIF stops the backend at
start, with an error that names the variable and not its value.

### The site issuer key

Make it once, on the backend's host, into a file only you can read:

```bash
postern keygen --out ~/.config/postern/site-issuer.wif
```

It prints the public key (Lampas names it `VITE_LAMPAS_SITE_ISSUER`) and never
the private one. Put the file's one line in the backend's environment file as
`POSTERN_SITE_ISSUER_KEY=<wif>`. At start the backend logs
`site issuer: <public key> at <address>`: fund that testnet address. The key
itself is never logged, printed with the config, or put in an error.

The backend builds and signs the licences itself, in Go (`internal/register`
tx.go: btcec for the key and signatures, the transaction, BIP-143 FORKID
sighash and @bsv/sdk's fee arithmetic written out). A mint is the same bytes
the TS issuer writes (spell-forge-bsv's `buildContractMintTransaction`, as
`src/services/issue.ts` calls it): the 1-sat License owned by the device key,
its Fuel (10,000 sat), the M record `{"collection":"lampas","holder":<address>}`
and the change; a revoke is `revokeLicence`'s W record
`{"kind":"revoke","origin":"<mint txid>:0"}`, 1 sat to `POSTERN_ANCHOR` and the
change. `internal/register/testdata/site-issuer-golden.json` holds one of each
as the TS code builds them (`tests/unit/site-issuer-golden.test.ts` keeps it so;
`UPDATE_SITE_ISSUER_GOLDEN=1` rewrites it) and the Go test compares byte for byte.

**Low balance.** A licence costs about 10,008 sat (the Fuel, the License and a
few sat of fee). At every start, when the site address holds less than 10
licences' worth (100,080 sat), the backend logs one line:

```
site issuer low: <sats>
```

The issuer spends every coin the address has and keeps one change. It remembers
what it spent and the change it made for a day, because WhatsOnChain lists a
spent coin, and leaves out fresh change, for a while after a broadcast; a
restart forgets, so an issue right after a restart may be refused until the
change is in a block (the caller is told to try again).

Start and confirm are open (no licence proof). Person and removing a device are
signed (`Postern2`, the same proof as the licensed routes) but need no licence
on the chain: person answers the mill's key (`POSTERN_MILL_KEY`) for any key, and
a device of a person for that person's keys only, because it links a person's
devices. CORS applies as for the rest.

| Route | Answers |
|---|---|
| `POST /api/register/start` `{email, phone, deviceKey}` | `200 {registrationId}` after Twilio sends a code to the email and one to the phone; `400` bad input (`phone` in E.164, `deviceKey` a compressed public key); `429` over the IP's hourly limit, the email's or the phone's (3 an hour, 10 a day) or the send cap; `502` Twilio could not be asked; `503` closed, or 10,000 registrations already waiting |
| `POST /api/register/confirm` `{registrationId, emailCode, phoneCode}` | `200 {personId, devices:[{key,name,addedAt,licenceTxid}], issued:true}` once the site issuer has broadcast the device's licence (its origin is `licenceTxid:0`; a device that holds one is not issued another); `400 {error, triesLeft}` a wrong code (5 wrong confirms end the registration; a code already right need not be sent again); `409` `that email is already registered`, `This licence already has 3 devices. Remove one first.` or the device is another licence's; `410` the registration expired (10 minutes), was used or ended; `429`; `502` the licence could not be issued (nothing stored; the registration stays, so confirm again without codes); `503` closed, or licensed by hand |
| `GET /api/register/person?key=<deviceKey>`, signed `Postern2` by the mill's key or by a device of that person | the mill: `200 {known:false}` or `200 {known:true, personId, keys:[...], dailyLimit}`; a device of the person `key` is on (itself too): `200 {known:true, personId, keys, dailyLimit}`; `401` no or a bad proof; `403` any other signer, the same for a registered key and an unknown one. Works with registration closed |
| `DELETE /api/register/device` `{deviceKey, personId}`, signed `Postern2` by a device of that person (itself too) | `200 {personId, devices}` after the site issuer's revoke of that device's licence is broadcast and the device dropped, which frees its slot; `401` no or a bad proof; `403` the signer is not a device of that person; `404` the device is not theirs; `502` the revoke could not be sent (nothing changed); `503` licensed by hand |

## Saved prompts

The backend is the definitive store of saved prompts, so any app can ask what
exists. They are kept whole as `prompts.json` under `POSTERN_DATA` (written to a
temp file and renamed into place). Every route needs the usual signed, licensed
proof (`Authorization: Postern <pubkey>:<nonce>:<sig>`).

| Route | Who | Answers |
|---|---|---|
| `GET /api/prompts` | any licensed key: cockpit, app or mill (and the Mayor's key, licence or not) | `200` a JSON array of prompts sorted by name (`[]` when none), with an `ETag`; `304` when `If-None-Match` matches it |
| `GET /api/prompts/{name}` | any licensed key | `200` the prompt, or `404` |
| `PUT /api/prompts/{name}` | a cockpit key (the home's) only | `200` the stored prompt; `400 {"error": "<one line>"}` for a bad prompt; `403` for any other key |
| `DELETE /api/prompts/{name}` | a cockpit key only | `204`, or `404` when there is no such prompt; `403` for any other key |

A backend started without a prompt store answers `501`.

### A prompt

```json
{
  "name": "sweep",
  "summary": "Sweep a place",
  "signature": [
    { "flag": "--duration", "type": "duration", "default": "30m", "required": false, "help": "how long" },
    { "flag": "--who", "type": "string", "required": true }
  ],
  "body": "Sweep {{who}}.",
  "updatedAt": "2026-10-01T12:00:00Z",
  "updatedBy": "<compressed public key hex of the writer>"
}
```

- `name`: lowercase, `[a-z0-9-]`, 1 to 32 characters. On `PUT` it comes from the
  path; a body that names a different prompt is a `400`.
- `signature`: the options, in order. Each `flag` begins `--` and appears once;
  `type` is one of `duration` (Go syntax, `30m`), `string`, `int`, `bool` or `text`
  (the free-text option: the words of a call that no flag takes; at most one per
  signature, a second is a `400`);
  `default` is a string that parses as the type (`""` or absent means none; any
  string is a `text` default);
  `required` and `help` are optional.
- `updatedAt` and `updatedBy` are stamped by the backend on every `PUT`; whatever
  the body says for them is ignored.
- A `PUT` replaces the whole prompt. The body is capped at 256 KiB.

The list's `ETag` is a hash of the list's JSON, so any `PUT` or `DELETE` moves it.
