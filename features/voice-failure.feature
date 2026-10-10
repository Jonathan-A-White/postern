Feature: When the phone's voice engine cannot speak, the screen says why, and Me can test the voice (mw-lcirxg)

  Scenario: mw-lcirxg AC1: a message the phone's voice fails to speak shows why under it and keeps its Play button
    Given the phone's voice engine refuses to speak with "audio-busy"
    And the Mayor's message "Three things landed." is shown
    When he taps "Read aloud" on the message
    Then the message says "Voice failed: audio-busy"
    And the message still has a "Read aloud" button

  Scenario: mw-lcirxg AC2: Me's Test voice speaks one sentence and says Spoken
    Given Me is open
    When he taps "Test voice"
    And the phone finishes speaking
    Then Me says "Spoken"

  Scenario: mw-lcirxg AC2: Me's Test voice shows the same note when the phone's voice fails
    Given the phone's voice engine refuses to speak with "not-allowed"
    And Me is open
    When he taps "Test voice"
    Then Me says "Voice failed: not-allowed"
