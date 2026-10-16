# Changelog

What changed in each version of Postern, newest first. The app shows the same lines from `public/changelog.json`.

## 0.6.35
_2026-10-16_
- New: A to-do can now have a Listen in Audible button that opens an audiobook, or a chapter of one, in the Audible app.

## 0.6.33
_2026-10-16_
- Fixed: on your Android phone the Text button on a to-do now opens Google Voice with the message typed, not the phone's own Messages app.

## 0.6.31
_2026-10-16_
- New: a texting to-do has a Text button that opens your texting app to the person with the message already written.

## 0.6.30
_2026-10-15_
- Fixed: Postern opens straight away on a long history instead of sitting on the padlock, and if it ever stalls it says what it waits on and offers Try again.

## 0.6.29
_2026-10-15_
- Fixed: With two questions open on one bead, tapping an answer on one now marks only that question as answered.

## 0.6.28
_2026-10-15_
- New: Your To do lists now show Today, Soon and Someday, with Soon and Someday folded to a count until you tap them.

## 0.6.27
_2026-10-15_
- New: To do cards have a star for important ones, say in words when they are due or overdue, and the ones due within two days or overdue float to the top of their list.

## 0.6.26
_2026-10-15_
- New: To do lists have a short one-line name and each card is a single compact row with a small round check, so many more fit on the phone.

## 0.6.25
_2026-10-15_
- New: Attach a screenshot or photo to a Talk turn.

## 0.6.23
_2026-10-15_
- New: a To do card now shows small link buttons (Kindle, Audible and so on) under its title that open the app directly.

## 0.6.22
_2026-10-14_
- Fixed: A notification for the Mayor's reply to a card now opens the card with the reply under it, instead of "That post is not on this phone".

## 0.6.21
_2026-10-14_
- Fixed: Postern no longer downloads the whole board about once a minute while the factory is busy; a new card from a hold, a landing or a finished story may take up to 15 minutes to appear unless you pull to refresh.

## 0.6.20
_2026-10-13_
- New: To do cards can have a due time shown on the card (red when it has passed), set or cleared on the card's back, a list can be sorted by due, and Me has a Reminders setting for sound and quiet hours.

## 0.6.19
_2026-10-13_
- New: You can now add, edit and rearrange the cards on your To do lists from the phone: hold a card to drag it, tap Add a card, or tap a card and choose Edit.

## 0.6.17
_2026-10-13_
- Fixed: Postern downloads far less data while you use it, because it no longer re-fetches the whole map every few seconds.

## 0.6.15
_2026-10-13_
- New: A To do tab shows your own lists as columns of cards; tap a card to turn it over for its notes, tap Done to close it.

## 0.6.14
_2026-10-13_
- New: Verify cards you have not touched for several days now fold into one 'Waiting on your use' line at the bottom of Needs you, and no longer count in the tab badge.

## 0.6.10
_2026-10-13_
- Fixed: Tapping a notification after Postern has been in the background now opens the message within a couple of seconds, or says it could not, instead of spinning for up to a minute.

## 0.6.7
_2026-10-13_
- Fixed: The balance line on the Key and licence issue form now says why it could not be read, tries again by itself, and updates after you issue a licence.

## 0.6.5
_2026-10-13_
- New: Pictures you send are now shrunk to at most 2400 px on the long side, so a screenshot keeps its full size and stays sharp while a big camera photo gets smaller.

## 0.6.4
_2026-10-13_
- Fixed: Postern no longer downloads the whole map over and over while the factory is busy, which saves mobile data.

## 0.6.0
_2026-10-12_
- New: While Ideas only is on, a banner at the top of every screen says until when, and everything you send says 'Recorded for after 21:00' at once; the Talk line says it aloud and is ready for your next turn.

## 0.6.0
_2026-10-12_
- New: While Ideas only is on, a banner at the top of every screen says until when; everything you send says "Recorded for after 21:00" at once, the Talk line says it aloud and is ready for your next turn, and taps say it in place of "waiting".

## 0.5.43
_2026-10-12_
- New: Settings now has an Ideas only section where you can set a time you are away (until 9 pm, until 7 am, for an hour, or a date), a weekly schedule, and choose whether the Mayor's ring and emergencies still reach you.

## 0.5.42
_2026-10-12_
- Fixed: Talk turns now always reach the Mayor in the order you spoke them, even when one has to wait or is retried.

## 0.5.39
_2026-10-11_
- New: a gallery of every Postern screen at phone, small phone and desktop sizes, published to the website and to GitHub, so another team can match Postern's look.

## 0.5.35
_2026-10-11_
- New: Save a picture from any message to your phone.

## 0.5.34
_2026-10-10_
- Fixed: The About screen no longer has a Check for updates button or a list of versions; a What's new on GitHub link takes you to the release notes instead.

## 0.5.33
_2026-10-10_
- Fixed: A message that waits because the chain service is busy now says so in one plain line instead of silently waiting or showing the service's own page.

## 0.5.32
_2026-10-10_
- Fixed: Revoking a licence now waits and tries again when WhatsOnChain is busy, and says plainly whether anything was spent.

## 0.5.31
_2026-10-10_
- Fixed: When WhatsOnChain turns the backend away, the phone now gets one short line instead of a page of web-server text.

## 0.5.29
_2026-10-10_
- New: Needs you now lists what you are waiting on others for, with who and since when, and after three working days it asks you to Chase, mark it Done or Keep waiting.

## 0.5.28
_2026-10-10_
- New: Needs you now shows a pull request waiting for your review, or a decision waiting on you, as its own kind of card with what to do and when it is done.

## 0.5.27
_2026-10-10_
- Fixed: Issuing a licence now waits and tries again when WhatsOnChain is busy, and says in one plain line whether anything was spent instead of printing its error page.

## 0.5.26
_2026-10-10_
- Fixed: A long unbroken string such as a transaction id in a bead's channel no longer pushes the thread sideways or runs out of its bubble.

## 0.5.25
_2026-10-10_
- New: A picture can be sent with one tap, no typing.

## 0.5.24
_2026-10-10_
- Fixed: The Issued licences list now keeps the rows it already knows when a re-read fails, and reads again by itself.

## 0.5.23
_2026-10-09_
- New: No visible change: a written audit of Postern against the PWA checklist, with the fixes ranked.

## 0.5.22
_2026-10-09_
- New: The Me page has a Test voice line that speaks one sentence and says Spoken or why it failed, and a message the phone cannot speak now says "Voice failed" and the reason under it.

## 0.5.21
_2026-10-09_
- New: No visible change: reading aloud now runs on the shared speech code, with the same buttons and behaviour.

## 0.5.20
_2026-10-09_
- New: No visible change: the What's new list was filled in for versions 0.5.12 to 0.5.18.

## 0.5.19
_2026-10-09_
- New: No visible change: a stand-by server can now relay what you send to the home server without storing anything.

## 0.5.18

2026-10-09

- Fixed: On the Talk line, the speaker button under the Mayor's answer now stops it while it is speaking, and Pause, Resume and Restart sit right beside it.

## 0.5.17

2026-10-09

- Fixed: Leaving a screen while the app reads aloud now pauses the reading, and the bar at the bottom offers Resume where it stopped, instead of cutting it off.

## 0.5.14

2026-10-09

- New: Tap a picture you attached or sent to see it full screen (pinch to zoom, Back to close), and tap an attached file to open or save it.

## 0.5.13

2026-10-09

- New: Reading aloud and the microphone are now tested against the shared lifelike speech and mic stand-ins, with a check for the channel mic.

## 0.5.12

2026-10-09

- Fixed: Channels, a channel's messages and Needs you keep showing what the phone holds while it says Reconnecting…, instead of emptying until the connection is back.

## 0.5.11

2026-10-09

- New: What's new in the app
