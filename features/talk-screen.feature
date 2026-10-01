Feature: The Talk line screen: hold to talk, a buzz, a spoken answer, tap to cut (mw-j0f2d.8)

  Scenario: AC-1: holding the button vibrates, listens and shows what he says as he says it
    Given the Talk line is open with a believable speech recogniser
    When he presses and holds the talk button
    Then the phone vibrates once and the recogniser is listening
    And the talk button reads "Release to send"
    When the recogniser hears "What landed" so far
    Then the live transcript reads "What landed"

  Scenario: AC-1: with his car's Bluetooth microphone among the inputs the hold listens on it and the screen names it (mw-j0f2d.26)
    Given the phone has the inputs "Speakerphone" and "Bluetooth headset"
    And the Talk line is open with a believable speech recogniser
    When he presses and holds the talk button
    Then the recogniser listens on the "Bluetooth headset" input
    And the screen says it is listening on "Bluetooth headset"
    When he says "what landed" and lets go
    Then the turn sent is "what landed"
    And the car's microphone is let go

  Scenario: AC-1: Android's own Headset earpiece is not taken for a Bluetooth input, so the hold uses the default microphone (mw-j0f2d.33)
    Given the phone has the inputs "Headset earpiece" and "Speakerphone"
    And the Talk line is open with a believable speech recogniser
    When he presses and holds the talk button
    Then the recogniser listens on the default input
    And the screen says it is listening on the phone's own microphone

  Scenario: AC-1: with only the phone's own inputs the hold uses the default microphone and the screen says so (mw-j0f2d.26)
    Given the phone has the inputs "Speakerphone" and "Phone microphone"
    And the Talk line is open with a believable speech recogniser
    When he presses and holds the talk button
    Then the recogniser listens on the default input
    And the screen says it is listening on the phone's own microphone

  Scenario: AC-1: a car input the recogniser cannot capture from falls back to the phone's own microphone (mw-j0f2d.26)
    Given the phone has the inputs "Phone microphone" and "Bluetooth headset"
    And the Talk line is open with a believable speech recogniser
    When he presses and holds the talk button
    And the recogniser finds no capture device on the car input
    Then the recogniser is started again on the default input
    And the screen says it is listening on the phone's own microphone

  Scenario: AC-1: earbuds whose microphone hears nothing are given up on, and the hold goes on on the phone's own microphone (mw-j0f2d.34)
    Given the phone has the inputs "Phone microphone" and "Bluetooth headset"
    And the Talk line is open with a believable speech recogniser
    When he presses and holds the talk button
    Then the recogniser listens on the "Bluetooth headset" input
    When the recogniser ends with no speech and no words
    Then the recogniser is started again on the default input
    And the screen says it is listening on the phone's own microphone
    When he says "what landed" and lets go
    Then the turn sent is "what landed"

  Scenario: AC-1: an Android phone that sends each growing hypothesis as a new result shows and sends the phrase once (mw-j0f2d.12)
    Given the Talk line is open with a believable speech recogniser
    When he presses and holds the talk button
    And the recogniser hears each growing hypothesis of "great I see the mic button now" as a new result
    Then the live transcript reads exactly "great I see the mic button now"
    When he lets go of the talk button
    Then one turn is sent saying "great I see the mic button now" as turn 1

  Scenario: AC-1: a no-speech error from the recogniser while he is still holding does not end the hold (mw-j0f2d.19)
    Given the Talk line is open with a believable speech recogniser
    When he presses and holds the talk button
    And the recogniser fails with "no-speech"
    Then the talk button reads "Release to send"
    And the screen does not say "No speech was heard."

  Scenario: AC-1: a recogniser that ends by itself while he holds is started again and his earlier words are kept (mw-j0f2d.19)
    Given the Talk line is open with a believable speech recogniser
    When he presses and holds the talk button
    And the recogniser hears "first part" so far
    And the recogniser ends by itself
    And the recogniser then hears "second part" so far
    Then the talk button reads "Release to send"
    And the live transcript reads exactly "first part second part"
    When he lets go of the talk button
    Then one turn is sent saying "first part second part" as turn 1

  Scenario: AC-1: a pause of many seconds while he holds does not end the turn, and both halves go as one turn (mw-j0f2d.27)
    Given the Talk line is open with a believable speech recogniser
    When he presses and holds the talk button
    And the recogniser hears "twenty Mississippi" so far
    And he stays silent for 5 seconds, 8 times over, the recogniser ending itself each time
    And the recogniser then hears "and now the rest" so far
    Then the talk button reads "Release to send"
    And the screen does not say "No speech was heard."
    And the live transcript reads exactly "twenty Mississippi and now the rest"
    When he lets go of the talk button
    Then one turn is sent saying "twenty Mississippi and now the rest" as turn 1

  Scenario: AC-1: releasing vibrates and sends his words as a turn
    Given the Talk line is open with a believable speech recogniser
    When he holds the talk button and says "What landed today?" and lets go
    Then the phone vibrates twice
    And one turn is sent saying "What landed today?" as turn 1
    And the screen shows "What landed today?" as what he said

  Scenario: AC-1: the thinking state shows from 8 s after his release until the answer (mw-j0f2d.31)
    Given the Talk line is open with a believable speech recogniser
    When he holds the talk button and says "Hello" and lets go
    Then the screen says the turn was sent and does not yet say the Mayor is thinking
    When 9 seconds pass with no answer
    Then the screen says the Mayor is thinking

  Scenario: AC-1: an answer is shown and spoken aloud
    Given the Talk line is open with a believable speech recogniser
    When he holds the talk button and says "What landed today?" and lets go
    And the Mayor answers "Three things landed." on model "sonnet"
    Then the screen shows "Three things landed." as the answer
    And the phone speaks "Three things landed."

  Scenario: AC-1: an answer's bead links show as chips under its text and tapping one opens the bead page (mw-j0f2d.18)
    Given the Talk line is open with a believable speech recogniser
    When he holds the talk button and says "What landed today?" and lets go
    And the Mayor answers "Three things landed." on model "sonnet" with the link "mw-x.1"
    Then the answer shows one link chip "mw-x.1" under its text
    And the phone speaks "Three things landed."
    When he taps the link chip "mw-x.1"
    Then the bead page of "mw-x.1" is open

  Scenario: AC-3: an answer without links shows no chips (mw-j0f2d.18)
    Given the Talk line is open with a believable speech recogniser
    When he holds the talk button and says "What landed today?" and lets go
    And the Mayor answers "Three things landed." on model "sonnet"
    Then the answer shows no link chips

  Scenario: AC-1: an answer scrolls the turn list down to the newest item (mw-j0f2d.13)
    Given the Talk line is open with a believable speech recogniser
    And the turn list is longer than the screen and he is reading its end
    When he holds the talk button and says "What landed today?" and lets go
    And the Mayor answers "Three things landed." on model "sonnet"
    Then the turn list scrolls down to the end
    And there is no "New answer" button

  Scenario: AC-1: the turn list stays on its newest answer when the controls below it change height (mw-j0f2d.23)
    Given the browser reports when the turn list changes size
    And the Talk line is open with a believable speech recogniser
    And the turn list is longer than the screen and he is reading its end
    When the turn list gets shorter because the controls below it grew
    Then the turn list is moved to the end again

  Scenario: AC-1: the turn list does not follow a resize once he has scrolled up to older turns (mw-j0f2d.23)
    Given the browser reports when the turn list changes size
    And the Talk line is open with a believable speech recogniser
    And the turn list is longer than the screen and he is reading its end
    When he scrolls the turn list up to older turns
    And the turn list gets shorter because the controls below it grew
    Then the turn list is left where it is

  Scenario: AC-1: an answer that comes while he has scrolled up does not move him, and a New answer button takes him down (mw-j0f2d.13)
    Given the Talk line is open with a believable speech recogniser
    And the turn list is longer than the screen and he is reading its end
    When he holds the talk button and says "What landed today?" and lets go
    And he scrolls the turn list up to older turns
    And the Mayor answers "Three things landed." on model "sonnet"
    Then the turn list does not scroll
    And there is a "New answer" button
    When he taps "New answer"
    Then the turn list scrolls down to the end
    And there is no "New answer" button

  Scenario: AC-1: a tap cuts the answer and his next turn says so
    Given the Talk line is open with a believable speech recogniser
    When he holds the talk button and says "Tell me everything" and lets go
    And the Mayor answers "A very long answer indeed." on model "sonnet"
    And he taps "Cut the answer"
    Then the speech is cancelled
    When he then holds the talk button and says "Skip that" and lets go
    Then the last turn sent is turn 2 saying "Skip that" with a cut

  Scenario: AC-1: the cut tag stays on his turn only until the Mayor's next answer arrives (mw-j0f2d.22)
    Given the Talk line is open with a believable speech recogniser
    When he holds the talk button and says "Tell me everything" and lets go
    And the Mayor answers "A very long answer indeed." on model "sonnet"
    And he taps "Cut the answer"
    And he then holds the talk button and says "Skip that" and lets go
    Then the turn "Skip that" shows the tag "cut the last answer"
    When the Mayor answers "Skipped." on model "sonnet"
    Then the turn "Skip that" no longer shows the tag "cut the last answer"

  Scenario: AC-1: the model chip goes into the turn
    Given the Talk line is open with a believable speech recogniser
    When he picks the "Opus" chip
    And he holds the talk button and says "Think hard" and lets go
    Then the last turn sent is turn 1 saying "Think hard" on model "opus"

  Scenario: AC-1: each answered turn shows how soon the first words came
    Given the Talk line is open with a believable speech recogniser
    When he holds the talk button and says "Quick one" and lets go
    And the Mayor answers "Done." 2.4 seconds later
    Then the answer shows "first words in 2.4 s"

  Scenario: AC-1: a talk holds the screen awake, and End sends end and lets it go
    Given the Talk line is open with a believable speech recogniser
    Then the screen is not held awake
    When he holds the talk button and says "Hello" and lets go
    Then the screen is held awake
    When he taps "End talk"
    Then the last turn sent has the role end
    And the screen is no longer held awake

  Scenario: AC-1: a send that fails is said plainly and the button works again
    Given the Talk line is open with a believable speech recogniser
    And sending a turn will fail
    When he holds the talk button and says "Hello" and lets go
    Then the screen says "Could not keep that on this phone. Try again."
    And the talk button reads "Hold to talk"

  Scenario: AC-1: a failed send keeps his words on the screen and Try again resends them
    Given the Talk line is open with a believable speech recogniser
    And sending a turn will fail
    When he holds the talk button and says "Hello there" and lets go
    Then the screen says "Could not keep that on this phone. Try again."
    And his words "Hello there" are still on the screen
    When sending a turn works again
    And he taps "Try again"
    Then the last turn sent says "Hello there" as turn 1
    And the talk button reads "Waiting for the Mayor…"

  Scenario: AC-1: a hold of about 2,000 words is cut at the cap with "..." and still sent
    Given the Talk line is open with a believable speech recogniser
    When he holds the talk button and says 2000 words and lets go
    Then the last turn sent is cut at the cap and ends with "..."
    And the talk button reads "Waiting for the Mayor…"

  Scenario: AC-1: a browser that cannot listen says so instead of a dead button
    Given the Talk line is open with no speech recogniser
    Then the screen says "This browser cannot turn speech into text."

  Scenario: AC-1: the screen says Listening only once the recogniser says the mic is open
    Given the Talk line is open with a speech recogniser that has not opened the mic yet
    When he presses and holds the talk button
    Then the screen says "Starting the mic…"
    And the screen does not say "Listening…"
    And the talk button reads "Starting the mic…"
    When the recogniser says the mic is open
    Then the screen now says "Listening…"
    And the talk button now reads "Release to send"

  Scenario: AC-1: an error from the recogniser during the hold ends it in words and the button works again
    Given the Talk line is open with a believable speech recogniser
    When he presses and holds the talk button
    And the recogniser fails with "bad-grammar"
    Then the screen says "The phone's speech service failed: bad-grammar."
    And the talk button reads "Hold to talk"
    And nothing is sent

  Scenario: AC-1: a microphone that is not allowed says how to allow it
    Given the Talk line is open with a believable speech recogniser
    When he presses and holds the talk button
    And the recogniser fails with "not-allowed"
    Then the screen says how to allow the microphone in the phone's Settings
    And the talk button reads "Hold to talk"

  Scenario: AC-1: a release the recogniser never answers gives up after three seconds
    Given the Talk line is open with a speech recogniser that never ends
    When he presses and holds the talk button
    And he lets go of the talk button
    Then within 4 seconds the screen says "No speech was heard."
    And the talk button reads "Hold to talk"
    And nothing is sent

  Scenario: AC-1: on-device recognition that fails is retried once in network mode, and the screen says so
    Given the Talk line is open with a believable speech recogniser
    When he presses and holds the talk button
    And the recogniser fails with "language-not-supported"
    Then a second recogniser is listening in network mode
    And the screen says "Starting the mic…"
    When the recogniser says the mic is open
    Then the screen now says "Speech on this phone is not available, so your browser sends the audio to its speech service."
    And the talk button reads "Release to send"

  Scenario: AC-1: the recogniser is asked for a full language tag, en-US when the page names none (mw-j0f2d.24)
    Given the Talk line is open with a believable speech recogniser
    When he presses and holds the talk button
    Then the recogniser was asked for "en-US"

  Scenario: AC-1: a language-not-supported error is retried once with en-US before the message shows (mw-j0f2d.24)
    Given the Talk line is open with a believable speech recogniser and the page language is "fr-FR"
    When he presses and holds the talk button
    And the recogniser fails with "language-not-supported"
    And the recogniser fails again with "language-not-supported"
    Then the latest recogniser was asked for "en-US"
    And the screen does not say "The phone's speech service failed: language-not-supported (this language is not available for speech recognition)."
    When the recogniser fails once more with "language-not-supported"
    Then the screen says "The phone's speech service failed: language-not-supported (this language is not available for speech recognition)."
    And the talk button reads "Hold to talk"

  Scenario: AC-2: End talk is not greyed after a failed hold, and tapping it clears the message (mw-j0f2d.24)
    Given the Talk line is open with a believable speech recogniser
    When he presses and holds the talk button
    And the recogniser fails with "language-not-supported"
    And the recogniser fails again with "language-not-supported"
    Then the screen says "The phone's speech service failed: language-not-supported (this language is not available for speech recognition)."
    And the "End talk" button is not greyed
    When he taps "End talk"
    Then the screen now says "Hold the button and speak."

  Scenario: AC-3: the bottom tab that lists the channels is called Channels
    Given the cockpit shell on a phone with the Channels place open
    Then the bottom menu offers "Needs you", "Map", "Channels", "Search" and "Me"
    And no screen calls the channel list "Talk"

  Scenario: AC-3: the Channels place offers a Talk to the Mayor button
    Given the cockpit shell on a phone with the Channels place open
    When he taps "Talk to the Mayor"
    Then the Talk line is open at ?v=line

  Scenario: AC-3: a long press on the Channels tab vibrates and opens the Talk line
    Given the cockpit shell on a phone with the Channels place open
    When he long presses the "Channels" tab
    Then the phone vibrates once
    And the Talk line is open at ?v=line

  Scenario: AC-3: a short tap on the Channels tab opens the channel list as before
    Given the cockpit shell on a phone with the Channels place open
    And he is on the Needs place
    When he taps the "Channels" tab
    Then the channel list is open at ?v=talk
    And the phone has not vibrated

  Scenario: AC-3: the Talk line is a place of its own under the Channels tab
    Then the route ?v=line is the Talk line and belongs to the Channels tab

  Scenario: AC-2: a small mark says whether the Mayor is here, and grey when no wait of his is connected (mw-j0f2d.28)
    Given the Mayor is away
    And the Talk line is open with a believable speech recogniser
    Then the Talk line shows "Mayor away" in grey
    When the Mayor is here and the phone comes back to the foreground
    Then the Talk line shows "Mayor here" in colour
    And the phone has not buzzed for it

  Scenario: AC-2: the phone buzzes once when the Mayor is back after a missed turn (mw-j0f2d.28)
    Given the Mayor is here
    And the Talk line is open with a believable speech recogniser
    When he holds the button, says "What landed" and lets go
    And the wait runs out
    Then the line says "The Mayor did not answer in time."
    When the Mayor is away and the phone comes back to the foreground
    Then the Talk line shows "Mayor away" in grey
    And the phone has not buzzed for it
    When the Mayor is here and the phone comes back to the foreground
    Then the Talk line shows "Mayor here" in colour
    And the phone buzzes once for it

  Scenario: AC-1: Call me sends a call request and the screen reads Call sent HH:MM (mw-a0ih0.1)
    Given the time is 14:05 and the Talk line is open with a believable speech recogniser
    When he taps the "Call me" button
    Then the call field reads "Call me"
    When he then taps the "Send" button
    Then one call request saying "Call me" at "14:05" was sent
    And the screen reads "Call sent 14:05"
    And the call field is gone

  Scenario: AC-2: Call sent stays until the Mayor rings or answers, and then goes (mw-a0ih0.1)
    Given a call request was sent at 14:05 and the Talk line is open with a believable speech recogniser
    Then the screen reads "Call sent 14:05"
    When the Mayor rings saying "Back now" at "14:06"
    Then the screen no longer reads Call sent

  Scenario: AC-3: Call me while the backend is unreachable goes on chain and the screen says Sent on chain (mw-a0ih0.4)
    Given the time is 14:05 and the Talk line is open with a believable speech recogniser
    And the backend cannot be reached and WhatsOnChain lists one coin
    When he taps the "Call me" button
    And he then taps the "Send" button
    Then the screen reads "Sent on chain 14:05, txid"
    And the call went to WhatsOnChain as one broadcast
    And the call field is gone

  # mw-a0ih0.3: the Mayor's ring.
  Scenario: AC-4: a ring shows the Mayor's reason (mw-a0ih0.3)
    Given the Mayor rang at 14:06 saying "Back now: two landings." and the Talk line is opened from its Answer tap
    Then the screen reads "The Mayor called 14:06: Back now: two landings." above the hold button
    When he leaves the Talk line and comes back
    Then the screen still reads "The Mayor called 14:06: Back now: two landings." above the hold button

  Scenario: AC-5: a missed call stays on the line until the next turn is sent (mw-a0ih0.3)
    Given the Mayor rang at 14:06 saying "Back now: two landings." and the Talk line is opened without answering
    Then the screen reads "Missed call 14:06: Back now: two landings." above the hold button
    When he holds the button, says "Tell me" and lets go
    Then the ring note is gone

  Scenario: AC-6: an answer that arrives by the sync with its talk turn event shows on the open line (mw-jrx0s.8)
    Given the Talk line is open with a believable speech recogniser
    When he holds the talk button and says "What landed today?" and lets go
    And a sync pages the Mayor's answer "Three things landed." and the event for that talk turn
    Then the screen shows "Three things landed." as the answer
