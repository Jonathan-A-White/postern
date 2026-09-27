# Demo: one message each way, on testnet, through the laptop's backend

This proves the whole skeleton at once: your phone holds a licensed key, a
message you send reaches the Mayor on the VPS, and a classified reply he
sends back reaches your phone with a push.

## Part 1 — you send 'hello' to the Mayor (on your phone)

1. On your Android phone, open https://postern.allmymind.org (or the
   installed Postern icon).
2. Unlock your key (fingerprint or your recovery phrase — docs/demo-key.md).
   The gate should open and show "Licensed" with your testnet address.
3. Tap "Send a message". If the Mayor's public key isn't already saved,
   paste it and tap "Save recipient".
4. Type `hello` in the Message box and tap "Send". You should see "Sent.
   Transaction id: `<txid>`" — note the txid for the resolution.

## Part 2 — the Mayor reads it and replies (on the VPS)

1. On the VPS, run:

   ```
   mw postern inbox
   ```

   It should print your message, decrypted, from your public key: `hello`.
2. The Mayor replies with a classified message:

   ```
   mw postern send --class decision-needed 'Ship it?'
   ```

   This prints a txid on success — note it for the resolution.

## Part 3 — the reply reaches your phone (on your phone)

1. Within a minute your phone should buzz with a push notification. A
   decision-needed class stays lit on screen until you dismiss it, rather
   than disappearing on its own.
2. Tap "Inbox" (or the notification itself). You should see the Mayor's
   reply, "Ship it?", marked `decision-needed` and unread (a "New" marker
   and a highlighted row).
3. Tap the row to read it — it opens the thread with the Mayor, showing
   both your `hello` and his reply.

## Resolution

Record on mw-1589l.13 whether Parts 1-3 ran as described, both txids (your
`hello` and the Mayor's reply), whether the push buzzed and stayed lit until
dismissed, and anything that blocked any part.
