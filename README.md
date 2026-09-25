# postern

Postern is a licence-gated, offline-first PWA that serves as the private, secure channel between the Governor and the Mayor: a BSV-backed gate that only opens for a holder of a valid licence token. It is built as a Vite + React + TypeScript app with a Dexie (IndexedDB) data layer, served at https://postern.allmymind.org, with a small Go backend under `server/`. Map: mw-f758y.

## Screenshots

A Builder runs `npm run shots` on demand (never in the gate) to capture every `tests/e2e/` spec's
screen at a 390px phone width into `test-results/shots/`. `npm run shots:publish -- <story-id>`
then rsyncs those into the story's own set. Sets land at
`https://postern.allmymind.org/shots/<story-id>/<name>.png`, with only the newest 30 stories' sets
kept on the VPS.
