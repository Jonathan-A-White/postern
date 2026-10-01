# postern

Postern is the Governor's cockpit for his software factory: one place to see what needs
him, the whole wayfinder map at any zoom, and every channel with the Mayor — by
text, voice, screenshots and files, pinned to the factory, a map, an epic, a story or a
single comment. It is an offline-first PWA (Vite, React, TypeScript, Dexie), served at
https://postern.allmymind.org, with a small Go backend under `server/` that runs beside
the factory on the desktop. BSV gives it identity and a licence gate; messages travel
end-to-end encrypted over a live connection (docs/protocol.md §9–§16). Plan:
vault `plans/0021-cockpit-plan.md`; demo: `docs/demo-cockpit.md`. Map: mw-f758y.

## Saved prompts

The **Prompts** screen (on Me, and from the Talk line) lists the Mayor's saved prompts with
their name, summary and options. **Run** opens the composer with `/name ` filled in; **Edit**
opens the channel `prompt:<name>`, a text conversation with the Mayor about it. In the composer,
typing `/` offers the prompts by name; choosing one inserts it, and a call such as
`/top5 --duration 15m` is checked against the prompt's options before Send (an unknown prompt
or a bad option shows an error and Send stays off). A good call goes as an ordinary message.
A **Talk** button on every card, hands step, thread and Prompts row opens the Talk line about
that thing. Protocol: docs/protocol.md §20 and §23.

## Screenshots

A Builder runs `npm run shots` on demand (never in the gate) to capture every `tests/e2e/` spec's
screen at a 390px phone width into `test-results/shots/`. `npm run shots:publish -- <story-id>`
then rsyncs those into the story's own set. Sets land at
`https://postern.allmymind.org/shots/<story-id>/<name>.png`, with only the newest 30 stories' sets
kept on the VPS.

## Licence

The code is released under the MIT licence; see [LICENSE](LICENSE). (This is the licence of the source code, not the Postern licence a key holds.)
