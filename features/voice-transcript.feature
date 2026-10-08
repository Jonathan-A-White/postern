Feature: A voice note shows its words under the player (mw-q6n8m0.4)

  Scenario: AC-1: a transcribed note shows its words
    Given a voice note in General that the Mayor's host has transcribed as "Make the ping interval twenty five seconds"
    When General opens
    Then the voice note shows the words "Make the ping interval twenty five seconds" under its player
    And no "more" is offered

  Scenario: AC-2: a long transcript is two lines with more, and more opens it all
    Given a voice note in General that the Mayor's host has transcribed as a long paragraph
    When General opens
    Then the transcript is held to two lines
    When he taps more
    Then the whole transcript is shown
    And he can tap less to fold it again

  Scenario: AC-3: a note with no transcript yet is the player alone
    Given a voice note in General with no transcript yet
    When General opens
    Then the voice note shows no words and no "more"

  Scenario: AC-4: a note already sent gets its words when the transcript arrives
    Given a voice note in General with no transcript yet
    When General opens
    And the Mayor's host sends the transcript "Call me back at six"
    Then the voice note shows the words "Call me back at six" under its player
