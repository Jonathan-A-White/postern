# A second backend on the same host: one instance per Linux user

Postern's backend is one process with one address, one data directory, one
Mayor key, one mill key and one issuer key. A host that serves more than one
person (the family plan, epic mw-9rp4hu) runs **one instance per Linux user**:
each user's own systemd user unit, started from the user's own env file and
data directory. Nothing is shared between the instances but the host, the
`postern` binary's code, and the chain.

## What `postern setup` does

Run as the member's own user, with the `postern` binary somewhere that user can
execute (e.g. `~/.local/bin/postern`):

```
postern setup --addr 10.88.0.2:8788 --issuer <issuer public key, hex>
```

- `--addr` (required): `host:port` this instance listens on. It must be a port
  no other instance on the host uses (the first backend is `:8787`).
- `--issuer` (required): the licence issuer's compressed public key: 66 hex
  characters starting `02` or `03`. Give every instance the **same** one (see
  below).
- `--apps` (optional, default `cairn=cairn`): `POSTERN_APPS`. A mill key needs
  at least one app (`docs/protocol.md` §19); change it in the env file later.
- `--anchor` (optional): the anchor address; defaults to the postern channel's
  (`docs/protocol.md` §3).

It checks everything first and **writes nothing** if the issuer key, address or
app list is bad, or if any file it would write is already there. Then, for
`$HOME`:

| File | What |
|---|---|
| `~/.config/postern/env` (0600) | `POSTERN_ADDR`, `POSTERN_ANCHOR`, `POSTERN_DATA=~/.local/state/postern`, a new `POSTERN_MAYOR_KEY` and `POSTERN_MILL_KEY`, `POSTERN_ISSUER_KEY`, `POSTERN_COLLECTIONS=postern`, `POSTERN_APPS` |
| `~/.config/mw/postern.key` (0600) | the Mayor key's private half, WIF: the file the member's `mw` already reads as `postern_key_file` (`mw postern key show` prints the same public key the env names) |
| `~/.config/mw/mill.key` (0600) | the mill key's private half, WIF |
| `~/.config/systemd/user/postern-backend.service` | the user unit: `ExecStart=` the `postern` that ran setup, `EnvironmentFile=` the env above |
| `~/.local/state/postern/` | the data directory (index, push and nonce keys, blobs, licence cache), made by the backend on first start |

and runs `systemctl --user daemon-reload` and
`systemctl --user enable --now postern-backend.service`. It prints the Mayor
key's public half (for the member's `mw` config and the cockpit) and the way
back. It never prints a private key.

A second run in the same home refuses and changes nothing: it names the file
that is already there.

Only the env file is the contract with the backend; any other variable
(`POSTERN_VIEW_FILE`, `POSTERN_BEAD_CMD`, `POSTERN_ON_MESSAGE`, `POSTERN_HOME_CMD`,
`POSTERN_CORS_ORIGINS`...) is added to that file by hand when the member's
`mw` is ready for it. Edit it, then `systemctl --user restart postern-backend`.

The user's systemd only runs while the user has a session unless lingering is
on: as root, `loginctl enable-linger <user>` (a hand step).

## `postern keygen`

```
postern keygen --out ~/some.key
```

Makes a fresh testnet secp256k1 key, writes the private half to the file as WIF
(0600, mw's key file format), refuses a file that is there, and prints the public
half. It never prints the private key. `postern setup` makes its two keys the
same way.

## The issuer key is shared

A licence is a token the **issuer's** key minted for a holder's key
(`docs/licence-token.md`, `docs/protocol.md` §16). A backend accepts a licence
only if `POSTERN_ISSUER_KEY` signed the mint. So a licence minted from the
holder's phone counts on the member's backend too, with no second mint, as
long as the member's backend is set up with the holder's issuer key. A backend
with another issuer key refuses it (`no_licence`).

The two tests that say so: `internal/api` `TestALicenceFromTheIssuerCountsOnBothBackendsAndNotOnOneWithAnotherIssuer`
(two backends built from two env maps over one chain), and `cmd/postern`
`TestTwoBackendsFromTwoEnvFilesRunSideBySideSharingNothing` (two `postern
setup` runs in two homes, both started, both answering `/healthz`, with
different Mayor keys, mill keys, data directories, nonce keys and push keys).

## Two instances on one host: what is shared and what is not

- **Files.** Everything an instance writes is under its own `POSTERN_DATA`,
  which is under its own user's home. Two users never share one.
- **Ports.** `POSTERN_ADDR` is the only port. Give each instance its own.
- **The anchor poller.** The poller (`internal/poller`) only reads: it asks
  WhatsOnChain for the anchor address's history every 5 seconds and indexes
  what is new into its own instance's index. It writes no file of its own and
  holds no lock, so two pollers on the same anchor do not collide; each indexes
  the whole channel. The cost is request volume: each instance's WhatsOnChain
  client spaces its own requests by 350 ms and knows nothing of the other, so
  two instances double the traffic to WhatsOnChain from this host's address
  (about one request every 2.5 seconds at rest, plus the licence walk's bursts).
  That is well under the free tier at rest; a third instance is the point to
  think about a shared chain cache.
- **The hooks.** `POSTERN_ON_MESSAGE`, `POSTERN_ON_GRIST` and
  `POSTERN_HOME_CMD` are per instance; a member's env leaves them unset until
  their own `mw` has the commands.

## The way back

`postern setup` prints it. For the user it ran as:

```
systemctl --user disable --now postern-backend.service
rm ~/.config/postern/env ~/.config/systemd/user/postern-backend.service ~/.config/mw/postern.key ~/.config/mw/mill.key
rmdir ~/.config/postern
rm -r ~/.local/state/postern
systemctl --user daemon-reload
```

Remove `postern.key` only if nothing else of that user holds a licence under it.
