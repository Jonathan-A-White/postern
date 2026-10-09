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

  Scenario: AC-5: sliding off the bar says Let go to drop and nothing is sent
    Given the composer is open
    When he taps the mic beside Send
    And he presses and holds the bar
    And the recogniser hears "never mind"
    And he slides his finger off the bar
    Then the bar says "Let go to drop"
    When he lets go off the bar
    Then nothing is delivered
    And the Hold to talk bar is there

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
