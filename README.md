# postern

Postern is the Governor's cockpit for his software factory: one place to see what needs
him, the whole wayfinder map at any zoom, and every conversation with the Mayor — by
text, voice, screenshots and files, pinned to the factory, a map, an epic, a story or a
single comment. It is an offline-first PWA (Vite, React, TypeScript, Dexie), served at
https://postern.allmymind.org, with a small Go backend under `server/` that runs beside
the factory on the desktop. BSV gives it identity and a licence gate; messages travel
end-to-end encrypted over a live connection (docs/protocol.md §9–§16). Plan:
vault `plans/0021-cockpit-plan.md`; demo: `docs/demo-cockpit.md`. Map: mw-f758y.

## Screenshots

A Builder runs `npm run shots` on demand (never in the gate) to capture every `tests/e2e/` spec's
screen at a 390px phone width into `test-results/shots/`. `npm run shots:publish -- <story-id>`
then rsyncs those into the story's own set. Sets land at
`https://postern.allmymind.org/shots/<story-id>/<name>.png`, with only the newest 30 stories' sets
kept on the VPS.
