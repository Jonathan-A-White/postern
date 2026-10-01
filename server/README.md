# postern backend

The Go backend behind https://postern.allmymind.org. Configuration is in
`internal/config`; the wire contract is `../docs/api.md` and
`../docs/protocol.md`. This file documents the saved-prompts routes.

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
  `type` is one of `duration` (Go syntax, `30m`), `string`, `int` or `bool`;
  `default` is a string that parses as the type (`""` or absent means none);
  `required` and `help` are optional.
- `updatedAt` and `updatedBy` are stamped by the backend on every `PUT`; whatever
  the body says for them is ignored.
- A `PUT` replaces the whole prompt. The body is capped at 256 KiB.

The list's `ETag` is a hash of the list's JSON, so any `PUT` or `DELETE` moves it.
