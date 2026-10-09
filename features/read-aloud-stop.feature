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

  Scenario: mw-q6n8m0.9 AC-3: a message's speaker shows the speaking bar with Pause, Resume, Restart and Stop
    Given the Mayor's message in the general thread is "First thing. Second thing. Third thing."
    When the general thread is opened in the shell and he taps "Read aloud"
    Then the speaking bar offers "Pause", "Restart" and "Stop"
    When the phone has begun the second sentence
    And he taps "Pause" in the bar
    Then the speaking bar now offers "Resume", "Restart" and "Stop"
    And the message's button still says "Stop reading"
    When he taps "Resume" in the bar to carry on
    Then the phone speaks "Second thing." and then "Third thing." again
    When he taps "Restart" in the bar to start over
    Then the phone speaks "First thing." and then "Second thing." and then "Third thing." again
    When he taps "Stop" in the bar to end it
    Then the speaking bar is gone and the message's button says "Read aloud" again

  Scenario: mw-q6n8m0.9 AC-3: leaving the screen stops the speech
    Given the Mayor's message in the general thread is "First thing. Second thing. Third thing."
    When the general thread is opened in the shell and he taps "Read aloud"
    And the screen is left
    Then nothing is speaking and the speaking bar is gone
