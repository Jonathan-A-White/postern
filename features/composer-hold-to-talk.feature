Feature: The composer's mic is the Talk line's hold-to-talk (mw-q6n8m0.3)

  Scenario: AC-1: tapping the mic opens the hold-to-talk bar
    Given the composer is open
    When he taps the mic beside Send
    Then the Hold to talk bar is there
    And the text box is gone

  Scenario: AC-2: while he holds the bar his words stream on the screen
    Given the composer is open
    When he taps the mic beside Send
    And he presses and holds the bar
    And the recogniser hears "check the build"
    Then the live transcript reads "check the build"
    And the bar says "Release to send"

  Scenario: AC-3: letting go sends one message with the words and the voice note
    Given the composer is open
    When he taps the mic beside Send
    And he holds the bar and says "check the build" and lets go
    Then one message is delivered with the words "check the build"
    And the message carries one attachment of mime "audio/webm"

  Scenario: AC-4: a picture already attached goes in the same message
    Given the composer is open
    When he attaches the picture "photo.png"
    And he taps the mic beside Send
    And he holds the bar and says "this screen is wrong" and lets go
    Then one message is delivered with the words "this screen is wrong"
    And the message carries 2 attachments
    And attachment 1 has mime "image/png"
    And attachment 2 has mime "audio/webm"

  Scenario: AC-5: sliding off the bar says Let go to keep it unsent, and nothing is sent (the words wait in the box since mw-f7gmps.3)
    Given the composer is open
    When he taps the mic beside Send
    And he presses and holds the bar
    And the recogniser hears "never mind"
    And he slides his finger off the bar
    Then the bar says "Let go to keep it unsent"
    When he lets go off the bar
    Then nothing is delivered
    And the text box holds "never mind"

  Scenario: AC-6: sliding back onto the bar before letting go still sends
    Given the composer is open
    When he taps the mic beside Send
    And he presses and holds the bar
    And the recogniser hears "kept it"
    And he slides his finger off the bar
    And he slides his finger back onto the bar
    And he lets go on the bar
    Then one message is delivered with the words "kept it"

  Scenario: AC-7: typed words and Send are unchanged, and the mic hides when there are words
    Given the composer is open
    When he types "look at this"
    Then the composer offers Send and no mic
    When he taps Send
    Then one message is delivered with the words "look at this"
    And the message carries 0 attachments

  Scenario: AC-8: a file shared in opens the composer with the bar ready, and one hold sends file, words and voice note
    Given a screenshot "shot.png" was shared into Postern and the composer opens
    Then the screenshot "shot.png" is attached
    And the Hold to talk bar is there
    When he holds the bar and says "what is this" and lets go
    Then one message is delivered with the words "what is this"
    And the message carries 2 attachments
    And attachment 1 has mime "image/png"
    And attachment 2 has mime "audio/webm"

  Scenario: AC-9: a hold with no words heard sends nothing and says so
    Given the composer is open
    When he taps the mic beside Send
    And he presses and holds the bar
    And he lets go on the bar
    Then nothing is delivered
    And the screen says "No speech was heard."

  Scenario: AC-10: earbuds whose microphone gives no words within 2.5 s are let go while he still holds, and what he says after that reaches the message (mw-f7gmps.1)
    Given the phone has the inputs "Phone microphone" and "Bluetooth headset"
    And the composer is open
    When he taps the mic beside Send
    And he presses and holds the bar
    Then the recogniser listens on the "Bluetooth headset" input
    And the screen says it is listening on "Bluetooth headset"
    When 2.5 seconds pass with no words, his finger still on the bar
    Then the recogniser is started again on the default input
    And the screen says it is listening on the phone's own microphone
    When he says "check the build" and lets go
    Then one message is delivered with the words "check the build"
    And the message carries no voice note from the earbuds

  Scenario: AC-11: the earbuds that heard nothing are not chosen again, and the next hold starts on the phone's own microphone at once (mw-f7gmps.1)
    Given the phone has the inputs "Phone microphone" and "Bluetooth headset"
    And the composer is open
    When he taps the mic beside Send
    And he holds the bar on the earbuds until they are given up on, says "first" and lets go
    And he presses and holds the bar again
    Then the recogniser listens on the default input at once
    And the earbuds are not opened again

  Scenario: AC-12: on a phone with only its own microphone the hold hears him as the Talk line's does, with no recorder holding the microphone beside the recogniser (mw-f7gmps.2)
    Given the phone has only the input "Phone microphone"
    And the recogniser hears nothing while a voice recorder holds the microphone
    And the composer is open
    When he taps the mic beside Send
    And he holds the bar and says "check the build" and lets go
    Then one message is delivered with the words "check the build"
    And no voice recorder opened the microphone beside the recogniser

  Scenario: AC-13: a hold dropped mid-speech leaves the words heard so far in the composer, unsent, and one tap sends them (mw-f7gmps.3)
    Given the composer is open
    When he taps the mic beside Send
    And he presses and holds the bar
    And the recogniser shows "the build is red on main" while he is still speaking
    And the phone takes the touch away from the bar
    Then nothing is delivered
    And the text box holds "the build is red on main"
    And the screen says "Kept what you said: tap Send."
    When he taps Send
    Then one message is delivered with the words "the build is red on main"

  Scenario: AC-14: the app going to the background mid-hold keeps the words heard so far in the composer, unsent (mw-f7gmps.3)
    Given the composer is open
    When he taps the mic beside Send
    And he presses and holds the bar
    And the recogniser hears "remember the release notes"
    And the page is hidden while he holds
    Then the recogniser was stopped
    And nothing is delivered
    And the text box holds "remember the release notes"
    And the screen says "Kept what you said: tap Send."

  Scenario: AC-15: the recogniser failing mid-hold keeps the words heard so far in the composer, unsent (mw-f7gmps.3)
    Given the composer is open
    When he taps the mic beside Send
    And he presses and holds the bar
    And the recogniser hears "the deploy went fine"
    And the recogniser fails with "audio-capture" while he holds
    And he lifts his finger where the bar was
    Then nothing is delivered
    And the text box holds "the deploy went fine"
    And the screen says "Kept what you said: tap Send."
    And the screen says why: "No microphone was found."

  Scenario: AC-16: letting go, the recogniser ends with a blank final after words were shown: those words are kept in the composer, unsent (mw-f7gmps.3)
    Given the composer is open
    And the recogniser's last result on letting go is blank
    When he taps the mic beside Send
    And he presses and holds the bar
    And the recogniser shows "ship it tonight" while he is still speaking
    And he lets go on the bar
    Then nothing is delivered
    And the text box holds "ship it tonight"
    And the screen says "Kept what you said: tap Send."

  Scenario: AC-17: a 3-minute hold the recogniser ends twice by itself keeps every word, and letting go sends them all (mw-f7gmps.3)
    Given the composer is open
    When he taps the mic beside Send
    And he presses and holds the bar
    And the recogniser hears "first the build"
    And a minute and a half passes and the recogniser ends by itself
    And the recogniser hears "then the tests" after it starts again
    And another minute and a half passes and the recogniser ends by itself again
    And the recogniser hears "then the landing" after it starts once more
    And he lets go on the bar
    Then the recogniser was started 3 times in the one hold
    And one message is delivered with the words "first the build then the tests then the landing"
