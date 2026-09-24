# Demo: the key vault, on your phone

This proves the key can live on your phone, unlocked by fingerprint, and be
recovered from its 12-word phrase on a second phone. No sats are involved —
this is a prototype of the key mechanism only.

## Part 1 — generate a key, unlocked by fingerprint

1. On your Android phone, open https://postern.allmymind.org/?screen=key in Chrome.
2. You should see "The key vault" with two buttons: "Generate a new key" and
   "Restore from a phrase".
3. Tap "Generate a new key". Twelve words appear on a single line — write them
   down on paper. They are shown once and are never stored on the phone. You
   can also tap "Copy the twelve words" to copy exactly those twelve words,
   space-separated, to paste into Part 2.
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

If step 6 doesn't offer "Unlock with your fingerprint" — the vault fell back
to wrapping the key with the phrase itself. When that happens, "Key unlocked"
in step 5 shows one line naming why, and step 6's locked screen names the
same reason inside its parenthetical. The three reasons and what each means:

- **fingerprint unlock is not available on this phone or browser** — this
  phone/Chrome build has no WebAuthn platform authenticator at all; the empty
  screen's "Fingerprint unlock on this device: not available" line already
  told you this in advance.
- **the passkey was created but reports no PRF support** — step 4's first
  fingerprint prompt (registering the passkey) succeeded, but a follow-up
  attempt to read its PRF secret failed outright, so this authenticator does
  not support the PRF extension.
- **the passkey did not return a usable fingerprint secret** — the passkey
  reported PRF support, but reading the secret came back empty; try clearing
  site data and starting Part 1 fresh, since this can be a one-off ceremony
  glitch rather than a genuine lack of support.

Any of these is an expected fallback, not a bug — note which one you saw as a
resolution either way. A fresh run of Part 1 needs Postern's site data cleared
first (Chrome: Settings, Site settings, All sites, postern.allmymind.org,
Delete data), otherwise step 6 will show the locked screen from a previous
run instead of prompting to generate a new key.

Type the phrase exactly as written; a capital letter, an autocorrected word, or
extra spaces from the keyboard don't matter — the app normalises the phrase
before checking it, and names any word it doesn't recognise from the recovery
wordlist.

## Part 2 — restore the key on a second phone (or after clearing site data)

1. On a second phone (or after clearing Postern's site data on the same
   phone, so it has no stored key), open
   https://postern.allmymind.org/?screen=key.
2. Tap "Restore from a phrase" and type in, or paste, the 12 words from Part 1.
3. Tap "Restore". You should land on "Key unlocked" showing the *same* key
   fingerprint as Part 1, step 5 — proving the phrase alone reconstructs the
   same key.

## Resolution

Record on mw-f758y.6 whether Parts 1 and 2 worked as described, whether your
phone's Chrome offered the fingerprint prompts in Part 1, and anything that
blocked either part. That result is what feeds the key design into the map's
decisions.
