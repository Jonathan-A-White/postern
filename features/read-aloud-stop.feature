Feature: A read-aloud speaker is a toggle: tap to read, tap again to stop (mw-ym1qi9.1)

  Scenario: mw-ym1qi9.1 AC1: the bead page's description speaker reads, then stops on a second tap
    Given the bead page of a bead with a description
    When he taps "Read the description aloud"
    Then the phone starts reading and the button now says "Stop reading"
    When he taps "Stop reading" a second time
    Then the phone stops reading and the button says "Read the description aloud" again

  Scenario: mw-ym1qi9.1 AC2: a Needs card's speaker reads, then stops on a second tap
    Given a Needs card with words to read
    When he taps "Read aloud"
    Then the phone starts reading and the button now says "Stop reading"
    When he taps "Stop reading" a second time
    Then the phone stops reading and the button says "Read aloud" again

  Scenario: mw-ym1qi9.1 AC3: a message's speaker reads, then stops on a second tap
    Given the Mayor's message in the general thread is "Three things landed today."
    When the general thread is opened and he taps "Read aloud"
    Then the phone starts reading and the button now says "Stop reading"
    When he taps "Stop reading" a second time
    Then the phone stops reading and the button says "Read aloud" again

  Scenario: mw-ym1qi9.1 AC4: the speaker returns by itself when the reading ends
    Given a Needs card with words to read
    When he taps "Read aloud"
    And the phone finishes reading
    Then the button says "Read aloud" again

  Scenario: mw-ym1qi9.1 AC5: starting a second speaker turns the first back to its speaker
    Given the Mayor's messages in the general thread are "First thing." and "Second thing."
    When the general thread is opened and he taps the first message's speaker
    And he taps the second message's speaker
    Then only the second message's speaker says "Stop reading"
