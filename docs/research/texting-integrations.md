# Research: texting from Postern through his own number

Story mw-ev7oyy.29 (2026-10-16). Read-only research, no code. The question, in the Governor's words
(Postern general, 2026-10-16): can a To do card's **Text** button "open Google Voice to a pre-populated
text ... that I could look at and send", and further, can Postern "accept integrations ... my Google
account ... that way you could just generate the text yourself and send it", the way nac-service-media
sends email as him; and can "my Google address book" tell Postern the number behind a name.

His constraint, which rules routes in or out before anything else: **"something which sends a text
that's not actually from me ... that's not useful."** A text must leave from his own number: his
Google Voice number (the app he texts from) or, at a stretch, the phone's carrier number. Anything
from a rented number is out.

<!-- toc -->

- [Short answer](#short-answer)
- [1. What Postern does today](#1-what-postern-does-today)
- [2. Route by route](#2-route-by-route)
  - [2.1 Open Google Voice with the draft (phone only, no account link)](#21-open-google-voice-with-the-draft-phone-only-no-account-link)
  - [2.2 A Google Voice API (personal or Workspace): there is none](#22-a-google-voice-api-personal-or-workspace-there-is-none)
  - [2.3 Send a text as him: a Gmail reply into a Google Voice conversation (the lead to test)](#23-send-a-text-as-him-a-gmail-reply-into-a-google-voice-conversation-the-lead-to-test)
  - [2.4 Send an email as him: the Gmail API, the nac-service-media way](#24-send-an-email-as-him-the-gmail-api-the-nac-service-media-way)
  - [2.5 His Google address book: the People API](#25-his-google-address-book-the-people-api)
  - [2.6 Android native routes: a Trusted Web Activity or a companion app sending SMS](#26-android-native-routes-a-trusted-web-activity-or-a-companion-app-sending-sms)
  - [2.7 Google's own: Messages for web, Assistant and Gemini](#27-googles-own-messages-for-web-assistant-and-gemini)
  - [2.8 Paid SMS services (Twilio and the like)](#28-paid-sms-services-twilio-and-the-like)
- [3. What only his phone can prove](#3-what-only-his-phone-can-prove)
  - [3.1 Phone-side (route 2.1)](#31-phone-side-route-21)
  - [3.2 The Gmail-reply route (route 2.3): a five-minute hand trial, before any story](#32-the-gmail-reply-route-route-23-a-five-minute-hand-trial-before-any-story)
- [4. The account link, done safely (applies to 2.3, 2.4 and 2.5)](#4-the-account-link-done-safely-applies-to-23-24-and-25)
- [5. Comparison](#5-comparison)
- [6. Worth a shared library?](#6-worth-a-shared-library)
- [7. Recommendation](#7-recommendation)
- [8. Decision card (for the Mayor to send)](#8-decision-card-for-the-mayor-to-send)
- [Sources](#sources)

<!-- /toc -->

## Short answer

1. **Google Voice has no API, for personal accounts or for Workspace, and its policy forbids
   automation.** Every "Google Voice API" on the internet is a scraper of the web app; Google has
   killed that class of app before (2014) and its Acceptable Use Policy today says "Do not automate
   our system to place phone calls or send messages automatically". Postern must never drive Voice
   behind his back.
2. **Opening Voice with the draft ready is a phone-side job, needs no account link, and is mostly
   already built.** The sms: link wrapped in a Chrome intent naming Voice works when the line has a
   number (mw-ev7oyy.23); a name-only line is the bug fixed beside this story (mw-ev7oyy.28: never the
   Play Store; the draft in the sms_body extra; copy the draft and open Voice when there is no number).
   What makes name-only lines work for good is the address book (route 5).
3. **Sending a text *as him* is possible by one documented Google route only: a Gmail reply into a
   Voice conversation.** Voice's own setting "Forward messages to email" sends each incoming text to
   his Gmail from a per-conversation address on txt.voice.google.com, and a reply to that email goes
   out as a text from his Voice number. The Gmail API can send that reply (scope gmail.send, which
   Google classes *sensitive*, not restricted). Two hard limits: it can only **reply in a conversation
   that already has an incoming text** (the address is generated per conversation and cannot be
   formed from a number), and Google's current help pages document the forwarding switch but **no
   longer document the reply**; it was announced in 2010 and user guides through 2021 describe it.
   So his five-minute hand trial (section 3.2) decides whether this route exists in 2026, before any
   story is written.
4. **Sending an email as him is straightforward**: the Gmail API with gmail.send, exactly as
   nac-service-media does it, with the token on the home and a confirm tap on the phone.
5. **His Google contacts can give a name its number**: the People API with contacts.readonly, under
   the same one Google sign-in, so a name-only Text: line opens Voice to the right person.
6. **Everything else is out by his constraint**: Twilio and friends (a rented number), a native
   companion app or a Trusted Web Activity sending SMS itself (the carrier number, and Play's SMS
   policy), Google Messages for web and Gemini's Messages extension (the carrier number).

Recommendation (section 7): link his Google account once, for contacts first; hand the draft to
Voice for him to send; add the Gmail-reply send only if his hand trial proves Voice still turns an
email reply into a text. The decision card is in section 8.

## 1. What Postern does today

A To do card's notes carry a `Text: <name> <number> | <draft>` line (docs/protocol.md, "A To do
card's notes"). `src/todo/links.ts` turns it into an `sms:<number>?body=<draft>` link; on Android
that link is wrapped as `intent:...#Intent;scheme=sms;package=com.google.android.apps.googlevoice;
S.sms_body=<draft>;S.browser_fallback_url=...;end`, so Chrome hands it to Voice by name rather than
to the phone's default texting app (mw-ev7oyy.23). Chrome's rule is that an `intent:` link opens the
named app's BROWSABLE activity, and if nothing resolves it, the fallback URL; in practice a named
package that cannot handle the data sends the user to its Play Store page, which is what his tap on
"Text Matthew Steele" (a name-only line, so `sms:` with no number) did. mw-ev7oyy.28 fixes that.
An `Email:` line is a `mailto:` link that Android hands to Gmail (mw-ev7oyy.26).

So the gap is not "open Voice": it is (a) a name without a number, and (b) his wish to skip the trip
through Voice altogether for a text the Mayor drafted.

## 2. Route by route

Each route answers the same six questions: whose number the text leaves from; what he sets up once;
the security risk and how it is contained; the cost; the size in stories; sources.

### 2.1 Open Google Voice with the draft (phone only, no account link)

Four ways to put the draft in front of him in Voice, from surest to least proven:

- **An sms: link with a number, wrapped as a Voice intent** (today's route). Voice opens the
  conversation with that number and the draft in the box, as Android texting apps read the
  `sms_body` extra and the `?body=` query. Needs a number on the line: with the address book (2.5)
  every name gets one.
- **Copy the draft to the clipboard and open Voice** (the fallback mw-ev7oyy.28 names for a line
  with no number). `navigator.clipboard.writeText` works on Android Chrome from a tap, on https.
  Postern says what it did ("Draft copied: pick Matthew Steele in Voice and paste") and opens Voice's
  plain launcher intent, which cannot end at the Play Store. He pastes and sends. Sure, but two taps
  more than he wants.
- **The Android share sheet** (the Web Share API, `navigator.share({ text })`, Android Chrome, from
  a tap, on https). The sheet lists every app that accepts shared text; if Voice is one, he taps
  Voice, picks the person, and the draft is in the box. Whether Voice registers as a share target
  for text is **not documented anywhere I could find** (no public copy of its manifest); only a tap
  on his phone proves it. If it does, this is the nicest no-number route: one tap, no clipboard.
- **A voice.google.com link to the conversation** (`.../messages?itemId=t.+1...` is a pattern users
  report; Google documents no such URL and no draft parameter). Unconfirmed; not worth a story.

- Sender number: **his Google Voice number**, because he sends from Voice.
- One-time setup: none.
- Security: nothing leaves the phone except what Android hands to Voice; no account, no token.
  Containment is already the rule: the button says who it texts; a tap that cannot open Voice says
  so instead of landing elsewhere.
- Cost: none.
- Size: the sms-with-number and clipboard routes are mw-ev7oyy.28 (in progress). The share sheet is
  **1 story** (a "Share draft" fallback when there is no number, proven by his tap). Nothing more.
- Sources: Chrome's Android intents page [1]; Android's common intents (ACTION_SENDTO, smsto:,
  sms_body) [2]; Web Share API [3]; Clipboard API [4].

### 2.2 A Google Voice API (personal or Workspace): there is none

Google publishes no API for Google Voice, personal or Workspace. The "APIs" on GitHub and PyPI
(pygooglevoice, node-google-voice, autogvoice, Google-Voice-PHP-API) log in to the web app and
scrape it; their own READMEs say they break whenever Google changes the site, and the PHP one says
"please do not contact me with support requests". Google ended third-party Voice apps in May 2014,
calling them unauthorised use and a security threat. The Voice Acceptable Use Policy, current, says:
"Do not send or facilitate the transmission of spam, large numbers of commercial messages, or
automated messages", lists "sending messages via an automated process, such as a script", and under
System Interference and Abuse, "Do not automate our system to place phone calls or send messages
automatically"; Google "may limit or terminate a user's access to Google Voice". Voice for Google
Workspace (Starter $10, Standard $20, Premier $30 per user per month) has texting in the US only and
no API either; the same terms apply. Scrapers would also mean his Google password or session cookie
on a server: **out, and not safe.**

- Sender number: n/a.
- Size: 0; this route is closed.
- Sources: Voice Acceptable Use Policy [5]; Google's 2013 notice on third-party apps [6]; Voice for
  Workspace plans [7]; Voice texting limits (US only for paid, no short codes, 7 in a group) [8].

### 2.3 Send a text as him: a Gmail reply into a Google Voice conversation (the lead to test)

**How it works.** In Voice's settings (voice.google.com, Settings, Messages), the switch
**"Forward messages to email"** sends every incoming text to the Gmail address of the Voice account
(and only that address). Each forwarded text arrives from a generated per-conversation address on
`txt.voice.google.com` (users report the shape `<his number>.<their number>.<opaque id>@...`; the id
is not derivable). A reply to that email is turned back into a text from his Voice number: Google
announced it in 2010 ("you can reply from email as well") and guides through 2021 describe it.
Google's current help page [9] documents the forwarding switch and says nothing about replying, for
or against. Nothing I found says it stopped; nothing current says it still works. Hence the hand
trial in 3.2 before anything is built.

**What Postern could do with it.** The home (not the phone, not the VPS) holds a Google OAuth token
for his account. When he taps **Send as text** on a card whose Text: line names a person he has a
Voice conversation with, the home finds the latest forwarded text from that person's number in his
Gmail (search `from:txt.voice.google.com`, that number in the address), takes its threadId and
reply address, and sends a reply with the same Subject and proper In-Reply-To and References headers
(the Gmail API's three conditions for a message to join a thread [10]). Voice texts it from his
number. The card shows "Sent to Matthew Steele from your Voice number" or what went wrong.

**Hard limits.**
- Only a conversation that already has an *incoming* text from that person has an address. A new
  conversation, or one where only he has ever texted, cannot be started this way: the tap falls
  back to opening Voice (2.1). This is most of the "Text Dad" cases only if Dad has texted him.
- Finding the address means reading his Gmail: `gmail.readonly` (or `gmail.metadata`), which Google
  classes **restricted**. Sending the reply needs only `gmail.send` (**sensitive**). The
  classification matters for verification (section 4), not for what the app can do. A way around
  the read scope on his account: a Gmail filter he sets once that auto-forwards mail from
  txt.voice.google.com to a mailbox the home owns (Gmail asks him to confirm that address once);
  then the home reads its own box and his account gives only gmail.send. One more thing to run on
  the home, but his inbox is never read.
- The Voice policy (2.2) forbids "automated messages" and "sending messages via an automated
  process, such as a script". One message, one deliberate tap, in a conversation he is already in,
  from his own Gmail, is the feature Google built; a scheduled or batched send would not be. Keep it
  one tap, one text, never a timer, never a list, and say so in the code.
- An email reply becomes an SMS: long drafts are split or cut by Voice; keep drafts short.

- Sender number: **his Google Voice number.**
- One-time setup: turn on "Forward messages to email" in Voice; one Google sign-in on the home
  (section 4); the hand trial first.
- Security risk: a refresh token that can read his mail (if gmail.readonly) and send mail as him.
  Containment: token on the home only, encrypted at rest with the vault's secrets (sops/age is
  already there), never on the VPS or the phone; the narrowest scopes; a confirm tap on the phone
  before every send, with the exact text and recipient on the card; one send per tap; Postern keeps
  nothing but the result line; he can revoke at myaccount.google.com/permissions at any moment and
  the next send says "Not linked" (section 4).
- Cost: none (Gmail API is free at this volume).
- Size: **about 4 stories** after a passing hand trial: Google sign-in and token store on the home
  (shared with 2.4 and 2.5); the Gmail reply sender with the thread finder; the phone side (the
  Send as text button, its confirm, its action to the home, the result on the card); the protocol
  and research-doc updates fold into those. One more if the forwarding-mailbox variant is chosen.
- Sources: Voice help, forwarding to Gmail [9]; TechCrunch 2010 on reply-by-email [11]; a 2021
  guide naming the setting and the from-address [12]; Gmail API threads [10] and sending [13]; Gmail
  scopes and their classes [14]; Gmail auto-forwarding [15].

### 2.4 Send an email as him: the Gmail API, the nac-service-media way

nac-service-media (`infrastructure/gmail/oauth.go`, read for this story) does it in Go: a Desktop
OAuth client, scope `gmail.send` only, a loopback redirect (`http://localhost:8086/callback`) that
opens the browser once, `access_type=offline` for a refresh token saved as a JSON file, refreshed
silently thereafter, and a browser re-sign-in when the refresh fails (bounded by a timeout when the
run is headless). Sending is `users.messages.send` with a base64url RFC 2822 message. That is the
right shape for Postern's home too, with two changes: the token file encrypted at rest, and a
confirm tap on the phone before each send.

A catch the nac rig does not record: a Google Cloud project whose consent screen is *External* and
whose publishing status is *Testing* issues refresh tokens that **expire after 7 days**, so a
headless home would want a browser every week. Publishing the app to *In production* without
verification is allowed for personal use (fewer than 100 users; the sign-in shows an "unverified
app" warning he clicks through once), and then refresh tokens live until revoked, unused for six
months, or his password changes (a Gmail-scope rule). Section 4 has the sources.

- Sender number: **his Gmail address.**
- One-time setup: a Google Cloud project with the Gmail API on, a Desktop OAuth client, the consent
  screen published for personal use, one sign-in on the home.
- Security risk: a token that can send mail as him (not read it). Containment as in 2.3.
- Cost: none.
- Size: **2 stories** on top of the sign-in story: the sender on the home; the phone's Send email
  button with confirm, beside today's Email button that opens Gmail.
- Sources: nac-service-media oauth.go [16]; Gmail scopes [14]; installed-app OAuth, loopback and
  PKCE [17]; refresh-token expiry rules [18]; publishing status and the 7-day rule [19]; personal-use
  exemption [20].

### 2.5 His Google address book: the People API

Under the same sign-in, scope `contacts.readonly` ("See and download your contacts"; third-party
guides and the Cloud Console class it sensitive, not restricted; the console labels each scope when
it is added) lets the home look a name up with `people.searchContacts` and read its phone numbers.
Then a `Text: Matthew Steele | <draft>` line gets Matthew's mobile number at filing time (the Mayor
asks the home when he files the card) or at tap time, and the sms:-with-number route (2.1) opens
Voice to the right person with the draft ready: the mw-ev7oyy.28 gap closed for good. The number
also identifies the Voice conversation's reply address in 2.3. Two names that match, or none, is a
question back to him, never a guess.

- Sender number: n/a (it feeds 2.1 and 2.3).
- One-time setup: the People API on in the same project; `contacts.readonly` in the same sign-in.
- Security risk: a token that can read every contact. Containment: read-only; the home asks for one
  name at a time and keeps only the number it needed, on the card it was filed for (or a cache with
  an expiry of days, never the whole book); the phone never holds the token or the book.
- Cost: none.
- Size: **2 stories** after the sign-in story: the lookup on the home with the Mayor's filing step
  (the Text: line gains a number); the phone's fallback when a name has no number (ask him once, keep
  the answer on the card).
- Sources: People API authorising [21]; People API overview [22]; sensitive-scope verification [23].

### 2.6 Android native routes: a Trusted Web Activity or a companion app sending SMS

A TWA is a native shell around the same PWA; it changes who shows notifications (docs/research/
notifications.md), not which app handles an sms: link, so it buys nothing here. A small native
companion could send SMS itself through SmsManager, but that text leaves from the **phone's SIM
number, not his Voice number**, which fails his constraint; and Google Play's SMS permission policy
allows SEND_SMS only to the default SMS handler (or a granted exception), so it would be sideloaded.
Out.

- Sender number: the carrier number. Out by his constraint.
- Size: 0.
- Sources: Play's SMS and Call Log policy [24]; Android common intents [2].

### 2.7 Google's own: Messages for web, Assistant and Gemini

Google Messages for web pairs a computer to the phone and sends from the **carrier number**, with no
API. Gemini's Messages extension on Android sends through "your phone's default messaging app" (the
carrier number again, and Voice cannot be the default SMS app). Google Assistant's 2017 promise of a
"send a Google Voice message" command is not documented today, and Assistant is being replaced by
Gemini. All three: not his Voice number, and nothing for Postern to call. Out.

- Sender number: the carrier number. Out by his constraint.
- Size: 0.
- Sources: Messages for web [25]; Gemini Messages extension [26]; the 2017 Assistant note [27].

### 2.8 Paid SMS services (Twilio and the like)

Twilio sends from a rented number (US SMS $0.0083 a segment plus carrier fees, a local number $1.15
a month, plus A2P 10DLC registration): a text from a number that is not his, which he has said is
not useful. **Out in one line.** Source: Twilio US pricing [28].

## 3. What only his phone can prove

### 3.1 Phone-side (route 2.1)

1. A `Text:` line with a number opens Voice to that person with the draft in the box (mw-ev7oyy.28
   adds the sms_body extra; his tap proves Voice reads it).
2. Whether Voice appears in the Android share sheet for shared text, and lands the text in a
   conversation he picks.

### 3.2 The Gmail-reply route (route 2.3): a five-minute hand trial, before any story

1. On a computer, voice.google.com, Settings (gear), Messages, turn on **Forward messages to
   email**.
2. Have someone text his Voice number (or text it from another phone).
3. In Gmail, open the forwarded text (from an address ending `@txt.voice.google.com`) and reply with
   one short line.
4. Right looks like: the reply arrives on the other phone as a text **from his Voice number** within
   a minute, and shows in the Voice app's conversation as sent by him.
5. Note the From address of the forwarded mail (its shape is the thread address the home would use).

If step 4 fails, route 2.3 does not exist in 2026 and the Gmail link is for email (2.4) and
contacts (2.5) only. If it passes, a second trial sends the same reply through the Gmail API from
the home (the sign-in story's first test), since Voice may treat an API-sent reply like one from the
Gmail app, or may not.

## 4. The account link, done safely (applies to 2.3, 2.4 and 2.5)

- **One sign-in, the narrowest scopes.** `contacts.readonly` (sensitive), `gmail.send` (sensitive),
  and `gmail.readonly` (restricted) only if the Gmail-reply route is chosen without the forwarding
  mailbox. Each scope is asked for only when its feature is built; Google's own rule is incremental,
  narrowest-scope requests. Never `https://mail.google.com/`, never `gmail.modify`.
- **The token lives on the home only.** The home host runs the Mayor's mw and holds the vault's
  secrets already; the refresh token goes in that store, encrypted at rest, readable by the one
  service that sends. Never the VPS (it serves the PWA and the backend and is exposed), never the
  phone (a PWA cannot keep a secret; the same reason the nac rig's installed app uses PKCE and
  treats its client secret as public).
- **The flow.** The phone never talks to Google. A tap on the card becomes an action to the home the
  way the To do board's §13 actions already reach it; the home does the send and posts the result
  back to the card. Postern stores on the phone nothing beyond that result line and, for contacts,
  the one number on the card.
- **A confirm tap before any send**, on the phone, showing the recipient, the sender ("from your
  Voice number" or "from your Gmail") and the full text; the button says what it will do ("Send to
  Dad as a text"); after the send it goes dead and says what happened (his rule: easy to use
  correctly, hard to use incorrectly). One tap, one message. Nothing on a timer, nothing in bulk.
- **Google Cloud project.** One project, the Gmail and People APIs on, a Desktop OAuth client (the
  loopback redirect, PKCE), consent screen External. Publishing status **In production, unverified,
  for personal use**: Google's verification FAQ says an app for personal use with fewer than 100
  users may skip verification and users click through the "unverified app" screen; in *Testing*
  status every refresh token dies after 7 days, which is wrong for a headless home. Verification and
  the annual CASA security assessment are for apps published to the public; Postern never is. To
  confirm in the console when the sign-in story runs: that the unverified production status does
  grant the restricted scope if one is requested; if it refuses, use the forwarding-mailbox variant
  (2.3) so only sensitive scopes are needed.
- **Revocation.** He revokes at any time at myaccount.google.com/permissions, or Postern's Me place
  gets an **Unlink Google** button that calls Google's revoke endpoint and deletes the token; a
  change of his Google password also kills a Gmail-scope token. After that every Send button says
  "Not linked" and the Voice handoff (2.1) still works.
- Sources: refresh-token expiry [18]; publishing status and test users [19]; verification FAQ and
  personal-use exemption [20]; restricted-scope verification and CASA [29]; installed-app OAuth,
  PKCE, revoke endpoint [17]; Gmail scope classes [14].

## 5. Comparison

| Route | From his number? | Setup once | Risk and its containment | Cost | Stories |
|---|---|---|---|---|---|
| 2.1 Open Voice with the draft (intent, clipboard, share sheet) | Yes (he sends in Voice) | none | none; the tap says what it did | 0 | .28 + 1 |
| 2.2 A Google Voice API or scraper | n/a | n/a | his password on a server; against the policy | 0 | out |
| 2.3 Gmail reply into a Voice conversation | Yes (Voice number) | forwarding switch, sign-in, hand trial | send-as-him token (+ read if no forwarding box); home-only, confirm tap, one per tap | 0 | ~4 |
| 2.4 Gmail API email as him | Yes (his Gmail) | sign-in | send-as-him token; home-only, confirm tap | 0 | 2 (+ sign-in) |
| 2.5 People API contacts | n/a (feeds 2.1, 2.3) | sign-in | read-all-contacts token; one lookup, one number kept | 0 | 2 (+ sign-in) |
| 2.6 Native SMS (companion, TWA) | No (carrier) | an APK | Play policy; sideload | 0 | out |
| 2.7 Messages for web, Gemini, Assistant | No (carrier) | n/a | n/a | 0 | out |
| 2.8 Twilio and the like | No (rented) | account, number, 10DLC | n/a | ~$1.15/mo + $0.0083/text | out |

The sign-in story (Google OAuth on the home, the token store, Unlink) is one story shared by 2.3, 2.4
and 2.5: **1 story**, then the routes above on top of it.

## 6. Worth a shared library?

Yes, if any of 2.3 to 2.5 is chosen. Two Go programs would then sign in to Google the same way:
nac-service-media (Gmail send, Drive) and the home's mw for Postern (Gmail send, People, maybe Gmail
read). nac's `infrastructure/gmail/oauth.go` is already the shape: a Desktop client, loopback
redirect, token file, silent refresh, browser re-sign-in. A small Go module in its own rig
(google-kit, the way bsv-kit and voice-kit serve more than one app) would hold: the sign-in with
PKCE and a loopback port chosen free; a token store behind an interface (a plain file for nac, the
vault's encrypted store for mw); the published-status gotcha written down once; Gmail send and
reply-in-thread; a People lookup by name. nac-service-media then loses its copy. **1 to 2 stories in
the kit's rig**, and the sign-in story in Postern's home becomes a pin bump plus the store.

## 7. Recommendation

1. **Now, no decision needed:** mw-ev7oyy.28 lands (a numbered line opens Voice with the draft;
   a name-only line copies the draft and opens Voice, never the Play Store).
2. **Link his Google account once, for contacts first (2.5 on the sign-in story):** every name-only
   Text: line gets its number from his address book, so his tap opens Voice to the right person with
   the draft ready, from his own number, and he reads and sends. Lowest risk (read-only, one number
   kept), biggest everyday gain, and the same sign-in later carries email and the Voice reply.
3. **The Gmail-reply send (2.3) only after his hand trial passes** (section 3.2). It is the one
   route that sends a text as him without his thumb in Voice, but it works only in conversations
   where the other person has texted him, Google no longer documents the reply, and it sits closest
   to the Voice policy's line; so it earns its stories only once he has seen it work by hand.
4. **Email as him (2.4)** is cheap once the sign-in exists; add it when a card's Email: line is
   something he would rather have sent than opened.
5. If more than one route is chosen, **extract google-kit** (section 6) before the second one.

## 8. Decision card (for the Mayor to send)

**Question:** Texting from a To do card: how far should Postern go with your Google account?

- **A. Hand it to Voice, with your address book.** Postern links to your Google account once, reads
  only your contacts, and every "Text Matthew" opens Google Voice to Matthew with the message ready;
  you read it and tap Send in Voice. Postern never sends anything itself. (About 3 stories.)
- **B. A, and Postern can send a text for you as a reply.** First you try one thing by hand (turn on
  "Forward messages to email" in Voice, reply to a forwarded text from Gmail, see it arrive from your
  Voice number). If that works, a "Send as text" button sends the message from your Voice number
  after you confirm it, in conversations where that person has texted you; otherwise it hands to
  Voice as in A. Postern can send mail as you too. (About 7 stories, your five-minute trial first.)
- **C. No account link.** Keep texting as it is once the current bug is fixed: a line with a number
  opens Voice with the message; a name alone copies the message and opens Voice for you to pick the
  person. (0 further stories.)

## Sources

1. Chrome, Android Intents with Chrome: https://developer.chrome.com/docs/android/intents
2. Android, Common intents (ACTION_SENDTO, smsto:, sms_body): https://developer.android.com/guide/components/intents-common
3. MDN, Navigator.share (Web Share API; transient activation; https only): https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share
4. MDN, Clipboard.writeText: https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText
5. Google Voice Acceptable Use Policy: https://support.google.com/voice/answer/9230450 (also https://www.google.com/googlevoice/program-policies.html)
6. Google ends third-party Voice apps (2013, effective May 2014): https://www.techradar.com/news/phone-and-communications/google-is-killing-third-party-voice-apps-as-it-expands-hangouts-support-1195885
7. Google Voice for Workspace plans: https://workspace.google.com/products/voice/
8. Google Voice help, Send and get text messages (limits): https://support.google.com/voice/answer/115116
9. Google Voice help, forwarding texts, missed calls and voicemail to Gmail ("Forward messages to email"): https://support.google.com/voice/answer/165221?hl=en&co=GENIE.Platform%3DDesktop
10. Gmail API, Managing threads (threadId, Subject, References and In-Reply-To): https://developers.google.com/workspace/gmail/api/guides/threads
11. TechCrunch, Google Voice Finally Marries SMS And Email (2010; "you can reply from email as well"): https://techcrunch.com/?p=99884
12. A 2021 user guide naming the setting and the txt.voice.google.com sender: https://gamewriter.videogamewriter.com/game-writer/text-forwarding-with-google-voice-2021/
13. Gmail API, Sending email: https://developers.google.com/workspace/gmail/api/guides/sending
14. Gmail API scopes and their classes (gmail.send sensitive; readonly, metadata, modify, compose restricted): https://developers.google.com/workspace/gmail/api/auth/scopes
15. Gmail help, Automatically forward Gmail messages to another account: https://support.google.com/mail/answer/10957
16. nac-service-media, infrastructure/gmail/oauth.go and README (Desktop client, gmail.send, token file): https://github.com/Jonathan-A-White/nac-service-media
17. Google, OAuth 2.0 for Mobile and Desktop Apps (loopback, PKCE, "installed apps cannot keep secrets", revoke endpoint): https://developers.google.com/identity/protocols/oauth2/native-app
18. Google, Using OAuth 2.0 (refresh-token expiry: Testing status 7 days, six months unused, password change with Gmail scopes): https://developers.google.com/identity/protocols/oauth2#expiration
19. Google Cloud, Manage your app audience / publishing status (100 test users, 7-day test authorisations, unverified-app screen, 100-user cap): https://support.google.com/cloud/answer/15549945
20. Google Cloud, OAuth verification FAQ (personal use under 100 users; testing not subject to verification): https://support.google.com/cloud/answer/13464323 and https://support.google.com/cloud/answer/9110914
21. People API, Authorize requests (scope classes): https://developers.google.com/people/v1/how-tos/authorizing
22. People API overview: https://developers.google.com/people
23. Google, Sensitive scope verification: https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
24. Google Play, Use of SMS or Call Log permission groups: https://support.google.com/googleplay/android-developer/answer/9047303
25. Google Messages help, Messages for web: https://support.google.com/messages/answer/7611075
26. Gemini help, the Messages extension ("uses your phone's default messaging app"): https://support.google.com/gemini/answer/15574940
27. Android Police, 2017, "send a Google Voice message" Assistant command promised: https://www.androidpolice.com/2017/09/05/ok-google-send-google-voice-message-command-coming-soon-help-google-voice-numbers/
28. Twilio, US SMS pricing: https://www.twilio.com/en-us/sms/pricing/us
29. Google, Restricted scope verification and the CASA assessment: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
