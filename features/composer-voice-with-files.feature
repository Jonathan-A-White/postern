Feature: A picture in the draft does not take the voice note away (mw-q6n8m0.1)

  Scenario: AC-1: with a picture and no words the mic stays beside Send
    Given the composer is open
    When he attaches the picture "photo.png"
    Then the composer offers both Send and Record a voice note

  Scenario: AC-2: with words typed the composer offers Send only
    Given the composer is open
    When he attaches the picture "photo.png"
    And he types "look at this"
    Then the composer offers Send and no Record a voice note

  Scenario: AC-3: a recorded voice note joins the picture and the mic goes
    Given the composer is open
    When he attaches the picture "photo.png"
    And he records a voice note
    Then the composer offers Send and no Record a voice note

  Scenario: AC-4: a picture and a voice note go out as one message carrying both files
    Given the composer is open
    When he attaches the picture "photo.png"
    And he records a voice note
    And he taps Send
    Then one message is delivered with two attachments
    And attachment 1 has mime "image/png"
    And attachment 2 has mime "audio/webm"
