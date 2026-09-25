# Demo: the project view, on your phone

This proves a question sent from the VPS reaches your phone under Needs you,
that tapping an option (or typing a reply) sends it back over postern, and
that his answer lands on the bead as his word — on testnet, end to end.

## Part 1 — the Mayor sends a question (on the VPS)

1. Pick a bead to ask about and note its id, e.g. `mw-xyz12.3`.
2. Run:

   ```
   mw postern send --class decision-needed --bead mw-xyz12.3 \
     --recommend A --option A --option B 'Ship the login change?'
   ```

   This broadcasts a §6 question to his key and comments the bead `QUESTION`
   with the txid, the text, the recommendation and the options, marking it
   open — `mw postern inbox` will know a reply naming this bead answers it.
   The command prints the txid on success.
3. `mw-mail-notify`'s tick runs once a minute and, on this host's postern key,
   calls `mw postern snapshot` again — the question now appears under
   `needs_you` in the freshly encrypted snapshot nginx serves. Check it
   landed with:

   ```
   curl -sI https://postern.allmymind.org/snapshot
   ```

   `200`, `Cache-Control: no-store`, and a `Content-Length` greater than 0 —
   the body itself is ciphertext, unreadable without his key.

## Part 2 — he answers (on his phone)

1. Open https://postern.allmymind.org/?screen=projects (or the installed
   Postern icon, then "Projects").
2. The Projects screen lists every live epic; the one holding the question
   floats to the top. Tap it.
3. Under "Needs you" is the question; tap its row.
4. The Question screen shows the text, "Recommended: A", a button per option
   ("A", "B") and a free-text box. Tap "Play" to hear it read aloud with the
   phone's own speech synthesis.
5. Tap "A" (or type a reply in the text box and tap "Send"). "Sent.
   Transaction id: `<txid>`" appears — his reply, signed by his key,
   broadcast like any message. The bead drops out of Needs you on this phone
   at once, without waiting for the next snapshot.

## Part 3 — the reply becomes his word on the bead

1. On the VPS, run `mw postern inbox`. Seeing a reply naming a bead it
   tracks, it appends the answer to that bead verbatim, clears the open
   question's note, and mails the Mayor so the notifier wakes the seat —
   instead of printing the reply as an ordinary message.
2. Check the bead:

   ```
   bd show mw-xyz12.3
   ```

   Its newest comment reads:

   ```
   ANSWER <when, RFC3339 UTC> from <his public key>, txid <txid>: A
   ```
3. Pull to refresh the Projects screen on his phone (or reload it after the
   next tick) — the bead no longer lists under Needs you there either.

## Resolution

Record on mw-tfne4.7 (or the epic mw-tfne4) whether Parts 1-3 ran as
described, the bead id and both txids (question and reply) used, and
anything that blocked any part.
