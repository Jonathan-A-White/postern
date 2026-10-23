# Changelog

What changed in each version of Postern, newest first. The app shows the same lines from `public/changelog.json`.

## 0.8.47
_2026-10-23_
- Fixed: When two questions are open on the same bead, answering one no longer makes the other disappear from Needs you, its badge or the bead page.

## 0.8.46
_2026-10-23_
- Fixed: When two decision cards are open on one channel, answering one no longer marks the other as answered, so the other can still be tapped.

## 0.8.43
_2026-10-23_
- Fixed: the app no longer keeps every factory event for good, and its lists of messages open faster on a phone with a long history.

## 0.8.42
_2026-10-23_
- Fixed: Tapping the Emergency banner now clears it at once, even when the phone holds a long history, and it stays gone after reopening.

## 0.8.37
_2026-10-20_
- Fixed: a to-do that is waiting on an unfinished story no longer offers Done on its own page or its Needs you card; it says what it waits on.

## 0.8.36
_2026-10-20_
- Fixed: A to do that waits on an unfinished job now says what it waits on, sits below the ones you can do, and has no Done until the wait is over.

## 0.8.34
_2026-10-20_
- New: Me has a Talk section where you choose whether to hold or tap the mic, and whether talking sends on release or waits for the Send button.

## 0.8.33
_2026-10-20_
- New: The message bar in every channel is now the shared bar your other apps will use; it looks and works as before.

## 0.8.30
_2026-10-20_
- Fixed: A long thing you say in Talk is no longer cut off with "..." at the end; the whole of it is sent to the Mayor.

## 0.8.28
_2026-10-20_
- Fixed: The Ideas only banner now says 'to-dos still work' instead of 'nothing is acted on until then'.

## 0.8.26
_2026-10-18_
- Fixed: Tapping 'Update ready, tap to reload' no longer gets stuck on 'Updating…'; if the new version is slow to take over, the app reloads on its own after a few seconds.

## 0.8.19
_2026-10-18_
- New: A To do text to a person with no number on file now asks for the number once, right on the card, and from then on opens Google Voice to them with the message ready.

## 0.8.18
_2026-10-18_
- Fixed: A Kindle link (or a phone, text or email link) in a post now opens the app it names instead of an empty page.

## 0.8.17
_2026-10-18_
- Fixed: Needs you opens again when hundreds of cards are waiting, instead of freezing the app.

## 0.8.16
_2026-10-18_
- Fixed: Text buttons with no phone number no longer send him to the Play Store; they copy the draft and open Google Voice, and with a number the draft is also handed to Voice as its message.

## 0.8.14
_2026-10-17_
- Fixed: Talk and the message mic now keep listening through a pause, so what you say after it is in the same message instead of lost.

## 0.8.13
_2026-10-17_
- Fixed: a to do of yours opened from its thread, or shown in Needs you, now has a Done button that closes it.

## 0.8.12
_2026-10-17_
- New: On a phone unlocked with a fingerprint, "Approve and run" on a step for your hands now asks only for your fingerprint and runs the step, with no second confirm box.

## 0.8.11
_2026-10-17_
- Fixed: A verify or approve card from a landing, a hold or a finished story now shows up in Postern within about a minute instead of up to a quarter of an hour.

## 0.8.8
_2026-10-17_
- Fixed: Tapping a message, reply or comment found by Search now opens it at that very item, marked, however old it is.

## 0.8.6
_2026-10-17_
- Fixed: A To do or decision card filed for you now shows up in Postern within about a minute instead of after several minutes.

## 0.8.4
_2026-10-17_
- Fixed: pausing mid-sentence while you hold the Talk button no longer rings a bell, and the words you say after the pause go in the same turn.

## 0.8.2
_2026-10-16_
- New: The Roadmap has a Picture view beside the lanes, showing every app and its epics as dots you can drag, zoom and tap to open.

## 0.8.1
_2026-10-16_
- New: A Roadmap on the Map shows all open work in four lanes (Now, Next, Later, Icebox) by app, each app opening to its titles.

## 0.8.0
_2026-10-16_
- New: Needs you and Map now show 'Up next: 3', the next stories the factory will start, and a tap lists them and opens any one.

## 0.7.2
_2026-10-16_
- New: A To do card with a date and time in it now has Add to Google Calendar and Download .ics buttons, so a one-off appointment lands on your calendar in two taps.

## 0.7.1
_2026-10-16_
- New: Every message on the Talk line, yours and the Mayor's, now has a Share button to copy it or send it on.

## 0.7.0
_2026-10-16_
- New: To do now opens on the few things worth doing right now, with everything else folded away under Later and the cards the pass let go under Let go, each with Keep or Drop.

## 0.6.47
_2026-10-16_
- New: A To do card's back now shows how big it is (Quick, an Hour, a Half day) and a Then line for what must follow, each a tap to change, and the card shows a small size mark.

## 0.6.46
_2026-10-16_
- Fixed: After Hold to talk fails, the button now says Try again, and the message names every way of listening that was tried.

## 0.6.45
_2026-10-16_
- Fixed: a to-do card with a line of links for each book now labels each button with its book, like "Kindle · Deep Discipleship", so you can tell which book it opens.

## 0.6.44
_2026-10-16_
- Fixed: A busy moment at the chain provider no longer locks a licensed key out of the backend for an hour; it is retried within half a minute.

## 0.6.43
_2026-10-16_
- Fixed: Postern no longer gets stuck on 'Connecting…' after you come back to it; a sync that hangs is given up on and the next one goes out at once.

## 0.6.40
_2026-10-16_
- New: a to-do with an email line has an Email button that opens your mail app to the right person with the subject and message already written.

## 0.6.39
_2026-10-16_
- New: iced stories now read Iced, fold into one Icebox row on their epic, and can be thawed with a tap.

## 0.6.37
_2026-10-16_
- Fixed: pasting a long note into Call me no longer cuts it off quietly at 500 characters; it keeps all of it, shows the count in red and says why Send is off.

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
