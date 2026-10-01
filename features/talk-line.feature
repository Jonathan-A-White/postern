Feature: Talk line turns are records of their own, and the line is a small state machine (mw-j0f2d.7)

  Scenario: AC-1: a turn survives encode and decode
    Given a turn 3 of talk "talk-1" saying "What landed today?" on model "sonnet" after a cut
    When the turn is encoded and decoded
    Then the decoded turn is the one he made
    And the encoded turn names the talk "talk-1" and turn 3

  Scenario: AC-1: optional fields stay out of a turn that does not use them
    Given a turn 1 of talk "talk-2" saying "Hello" on no model without a cut
    When the turn is encoded and decoded
    Then the decoded turn is the one he made
    And the encoded turn has no model and no cut

  Scenario: AC-1: words that are not a turn do not decode as one
    Then plain text, a message body and a malformed turn all decode to nothing

  Scenario: AC-1: a turn is delivered as class talk to the Mayor
    Given the Mayor's key is known
    When he delivers a turn 2 of talk "talk-3" saying "Why?"
    Then one record of class "talk" is posted to the Mayor
    And the Mayor reads the turn he made
    And no summary rides in the clear

  Scenario: AC-2: holding the button listens, and releasing with words sends a turn
    Given the line is idle
    When he holds the button for talk "talk-4"
    Then the line is listening
    When he releases with the words "What landed today?"
    Then the line is sending
    And the turn to send is turn 1 of "talk-4" saying "What landed today?" with no cut
    When the turn has been sent at 1000
    Then the line is waiting

  Scenario: AC-2: releasing with no words, or cancelling, goes back to idle
    Given the line is idle
    When he holds the button for talk "talk-5"
    And he releases with the words "   "
    Then the line is idle
    When he holds the button again for talk "talk-5"
    And he cancels
    Then the line is idle again
    And nothing is left to send

  Scenario: AC-2: an answer is spoken and the line goes back to idle
    Given the line is waiting on turn 1 of "talk-6"
    When the Mayor answers "Three things landed." on model "sonnet"
    Then the line is speaking "Three things landed."
    And the chip says "sonnet" answered
    When the speaking ends
    Then the line is idle

  Scenario: AC-2: a holding answer is spoken, then the line waits for the real one
    Given the line is waiting on turn 1 of "talk-7"
    When the Mayor says holding "One moment."
    Then the line is speaking "One moment."
    When the speaking ends
    Then the line is waiting
    When the Mayor answers "Done: two landings." on model "opus"
    Then the line is now speaking "Done: two landings."

  Scenario: AC-2: the real answer cuts across a holding answer still being spoken
    Given the line is waiting on turn 1 of "talk-8"
    When the Mayor says holding "One moment."
    And the Mayor answers "Done." on model "opus"
    Then the line is speaking "Done."

  Scenario: AC-2: a tap cuts the answer, and his next turn says so
    Given the line is speaking "A long answer." for turn 1 of "talk-9"
    When he cuts the answer
    Then the line is idle
    When he holds the button for talk "talk-9"
    And he releases with the words "Skip that."
    Then the turn to send is turn 2 of "talk-9" saying "Skip that." with a cut

  Scenario: AC-2: holding the button over a spoken answer cuts it and listens
    Given the line is speaking "A long answer." for turn 1 of "talk-10"
    When he holds the button for talk "talk-10"
    Then the line is listening
    When he releases with the words "Stop."
    Then the turn to send is turn 2 of "talk-10" saying "Stop." with a cut
    And nothing else is said

  Scenario: AC-2: no answer in time ends the wait and says so
    Given the line is waiting on turn 1 of "talk-11" since 1000
    When the clock reads 20000
    Then the line is still waiting
    When the clock then reads 40000
    Then the line is idle
    And the line says "The Mayor did not answer in time."
    When the Mayor answers "Late." on model "sonnet"
    Then the line is still idle

  Scenario: AC-2: an answer to another talk or turn is ignored
    Given the line is waiting on turn 1 of "talk-12"
    When the Mayor answers "Wrong talk." for turn 1 of "other-talk"
    And the Mayor answers "Old turn." for turn 5 of "talk-12" too
    Then the line is waiting

  Scenario: AC-2: a failed send goes back to idle and gives the turn number back
    Given the line is idle
    When he holds the button for talk "talk-13"
    And he releases with the words "Hello"
    And the send fails
    Then the line is idle
    And the line says "Could not send. Try again."
    When he holds the button again for talk "talk-14"
    And he then releases with the words "Hello again"
    Then the turn to send is turn 1 of "talk-14" saying "Hello again" with no cut

  Scenario: AC-1: a failed send keeps his words and Try again resends them as the same turn
    Given the line is idle
    When he holds the button for talk "talk-30"
    And he releases with the words "Hello there"
    And the send fails
    Then the line is idle
    And the line says "Could not send. Try again."
    And the line still holds the unsent words "Hello there"
    When he asks to try again
    Then the turn to send is turn 1 of "talk-30" saying "Hello there" with no cut
    When the send goes through
    Then the line is waiting
    And the line holds no unsent words

  Scenario: AC-1: a turn longer than the cap is cut with "..." and still sent
    Given the line is idle
    When he holds the button for talk "talk-31"
    And he releases with 40000 words
    Then the line is sending
    And the turn to send ends with "..." and is within the cap

  Scenario: AC-2: the model is chosen per talk and rides on his turns
    Given the line is idle
    When he picks the model "opus"
    And he holds the button for talk "talk-15"
    And he releases with the words "Think hard."
    Then the turn to send is turn 1 of "talk-15" saying "Think hard." on model "opus"
    When the talk ends
    Then the line is idle
    And the line has no model

  Scenario: AC-2: the Mayor ending the talk ends it for both
    Given the line is waiting on turn 1 of "talk-16"
    When the Mayor ends the talk
    Then the line is idle
    And the line has no talk

  Scenario: AC-3: a talk record is absent from channel lists, unread counts and Needs
    Given a stored channel message "Real message" and a stored talk record "Spoken words"
    When Talk opens and the badges are read
    Then the channel list shows "Real message" and never "Spoken words"
    And the unread count is 1
    And Needs has no entry for the talk record
