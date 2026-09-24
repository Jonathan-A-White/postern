# Demo: the key vault, on your phone

This proves the key can live on your phone, unlocked by fingerprint, and be
recovered from its 12-word phrase on a second phone. No sats are involved —
this is a prototype of the key mechanism only.

## Part 1 — generate a key, unlocked by fingerprint

1. On your Android phone, open https://postern.allmymind.org/?screen=key in Chrome.
2. You should see "The key vault" with two buttons: "Generate a new key" and
   "Restore from a phrase".
3. Tap "Generate a new key". Twelve words appear — write them down on paper.
   They are shown once and are never stored on the phone.
4. Tap "I've written it down". Chrome should prompt you to register a passkey —
   confirm with your fingerprint. A moment later it should ask for your
   fingerprint again (this second prompt reads the secret the first one
   created).
5. You should land on "Key unlocked" with a short "Key fingerprint" hex value.
   Note it down for Part 2.
6. Reload the page (still at `?screen=key`). You should now see "Unlock with
   your fingerprint" — tap it and confirm with your fingerprint. You should
   land back on "Key unlocked" with the same fingerprint as step 5.

Before tapping "Generate a new key", the empty screen shows one line:
"Fingerprint unlock on this device: available / not available". That tells you
in advance which path you're on — note it for the resolution.

If step 4 never prompts for a fingerprint and instead goes straight to "Key
unlocked", your phone or Chrome build doesn't support the PRF extension; the
vault fell back to wrapping the key with the phrase itself, and step 6 will
show "This phone holds your key wrapped by the recovery phrase (fingerprint
unlock was not available when it was created): type the twelve words" and ask
you to type the phrase back in, rather than offering a fingerprint prompt.
That is the expected fallback, not a bug — note it as a resolution either way.

Type the phrase exactly as written; a capital letter, an autocorrected word, or
extra spaces from the keyboard don't matter — the app normalises the phrase
before checking it, and names any word it doesn't recognise from the recovery
wordlist.

## Part 2 — restore the key on a second phone (or after clearing site data)

1. On a second phone (or after clearing Postern's site data on the same
   phone, so it has no stored key), open
   https://postern.allmymind.org/?screen=key.
2. Tap "Restore from a phrase" and type in the 12 words from Part 1.
3. Tap "Restore". You should land on "Key unlocked" showing the *same* key
   fingerprint as Part 1, step 5 — proving the phrase alone reconstructs the
   same key.

## Resolution

Record on mw-f758y.6 whether Parts 1 and 2 worked as described, whether your
phone's Chrome offered the fingerprint prompts in Part 1, and anything that
blocked either part. That result is what feeds the key design into the map's
decisions.
