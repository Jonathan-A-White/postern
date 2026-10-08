Feature: A picture in the draft does not take the voice note away (mw-q6n8m0.1; the voice note is the held bar since mw-q6n8m0.3)

  Scenario: AC-1: with a picture and no words the mic stays beside Send
    Given the composer is open
    When he attaches the picture "photo.png"
    Then the composer offers both Send and Speak a message

  Scenario: AC-2: with words typed the composer offers Send only
    Given the composer is open
    When he attaches the picture "photo.png"
    And he types "look at this"
    Then the composer offers Send and no Speak a message

  Scenario: AC-3: tapping the mic with a picture attached brings out the bar and keeps the picture
    Given the composer is open
    When he attaches the picture "photo.png"
    And he taps the mic
    Then the Hold to talk bar is out and the picture "photo.png" is still attached

  Scenario: AC-4: a picture and a voice note go out as one message carrying both files
    Given the composer is open
    When he attaches the picture "photo.png"
    And he taps the mic
    And he holds the bar, says "hello" and lets go
    Then one message is delivered with two attachments
    And attachment 1 has mime "image/png"
    And attachment 2 has mime "audio/webm"
