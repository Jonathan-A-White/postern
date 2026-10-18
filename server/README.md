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
| `POSTERN_REGISTER_IP_HEADER` | the header the proxy sets to the caller's address, for the limits (nginx: `proxy_set_header X-Real-IP $remote_addr;` and `X-Real-IP`); unset counts the connection's own address, which behind nginx is every caller at once |

With any of the three Twilio names missing, registration is closed: start and
confirm answer `503 {"error":"registration closed"}` and nothing else changes.

All three routes are open (no licence proof); CORS applies as for the rest.

| Route | Answers |
|---|---|
| `POST /api/register/start` `{email, phone, deviceKey}` | `200 {registrationId}` after Twilio sends a code to the email and one to the phone; `400` bad input (`phone` in E.164, `deviceKey` a compressed public key); `429` over the hourly limit; `502` Twilio could not be asked; `503` closed |
| `POST /api/register/confirm` `{registrationId, emailCode, phoneCode}` | `200 {personId, devices:[{key,name,addedAt}], issued:false}` (issuing is a later step); `400 {error, triesLeft}` a wrong code (5 wrong confirms end the registration; a code already right need not be sent again); `409` `that email is already registered`, `This licence already has 3 devices. Remove one first.` or the device is another licence's; `410` the registration expired (10 minutes), was used or ended; `429`; `503` |
| `GET /api/register/person?key=<deviceKey>` | `200 {known:false}` or `200 {known:true, personId, keys:[...], dailyLimit}` (the mill's lookup; works with registration closed) |

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
