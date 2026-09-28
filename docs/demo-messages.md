# Demo: a screenshot from the phone to the Mayor

> **Historical (plans/0021, 2026-09-28).** The screens this walks through were replaced by the cockpit; the demo to run now is [`docs/demo-cockpit.md`](demo-cockpit.md). Kept as the record of what was demonstrated then.

The demo for `mw-dxy1c`, the epic that lets the Governor attach one image, with
an optional caption, to a thread reply (phone to Mayor only — the reverse
direction is out of scope).

1. On his phone the Governor opens the Mayor's thread.
2. He taps "Attach image" in the reply box and picks a screenshot.
3. He types a caption and taps Send.
4. The thread shows the sent row with an image marker and the size (for
   example "look at this — Image, 210 KB").
5. Within a minute the Mayor's window is nudged; `mw postern inbox` prints
   the caption and the path of the decrypted image.
6. The Mayor reads the file and replies in the thread describing what is on
   it.
7. A 12 MB photo is refused on the phone before any upload, with a message
   naming the 8 MB cap.

## Success criteria

- `npm ci && TZ=UTC npm test && npm run typecheck && npm run lint` and
  `cd server && go build ./... && go test ./...` pass on a fresh clone of
  postern; `make build`, `make test` and `make lint` pass in millwright.
- The demo above runs from the Governor's phone: a screenshot with a caption
  reaches the Mayor as a readable decrypted file within a minute; an oversize
  image is refused on the phone; the backend deletes blobs after 30 days
  (proved by test); every rig's gate green.
