Feature: The Talk line screen: hold to talk, a buzz, a spoken answer, tap to cut (mw-j0f2d.8)

  Scenario: AC-1: holding the button vibrates, listens and shows what he says as he says it
    Given the Talk line is open with a believable speech recogniser
    When he presses and holds the talk button
    Then the phone vibrates once and the recogniser is listening
    And the talk button reads "Release to send"
    When the recogniser hears "What landed" so far
    Then the live transcript reads "What landed"

  Scenario: AC-1: releasing vibrates and sends his words as a turn
    Given the Talk line is open with a believable speech recogniser
    When he holds the talk button and says "What landed today?" and lets go
    Then the phone vibrates twice
    And one turn is sent saying "What landed today?" as turn 1
    And the screen shows "What landed today?" as what he said

  Scenario: AC-1: the thinking state shows between his release and the answer
    Given the Talk line is open with a believable speech recogniser
    When he holds the talk button and says "Hello" and lets go
    Then the screen says the Mayor is thinking

  Scenario: AC-1: an answer is shown and spoken aloud
    Given the Talk line is open with a believable speech recogniser
    When he holds the talk button and says "What landed today?" and lets go
    And the Mayor answers "Three things landed." on model "sonnet"
    Then the screen shows "Three things landed." as the answer
    And the phone speaks "Three things landed."

  Scenario: AC-1: a tap cuts the answer and his next turn says so
    Given the Talk line is open with a believable speech recogniser
    When he holds the talk button and says "Tell me everything" and lets go
    And the Mayor answers "A very long answer indeed." on model "sonnet"
    And he taps "Cut the answer"
    Then the speech is cancelled
    When he then holds the talk button and says "Skip that" and lets go
    Then the last turn sent is turn 2 saying "Skip that" with a cut

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
    Then the screen says "Could not send. Try again."
    And the talk button reads "Hold to talk"

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
