Feature: Needs you lists what is waiting on others, and a chase after three working days (mw-xpy2ds)

  Scenario: mw-xpy2ds: a bead waiting on others is listed under Waiting on others with who and since when, and does not count as waiting on him
    Given a view with a question for him and a bead waiting on others
    When the Needs screen opens inside the shell
    Then the Waiting on others section reads "Waiting on others · 1"
    And it lists "Write the permissions memo" with "Waiting on sam (tl) since 9 Oct 12:00 UTC" and how long ago it was asked
    And it offers no buttons
    And the switch reads "You · 1", "Mayor · 0" and "Factory · 0"
    And the Needs you tab badge reads "1"

  Scenario: mw-xpy2ds: with nothing waiting on others there is no Waiting on others section
    Given a view with a question for him and nothing waiting on others
    When the Needs screen opens
    Then there is no Waiting on others section

  Scenario: mw-xpy2ds: a chase need is his, and offers Chase, Done and Keep waiting
    Given a view with a chase need for him
    When the Needs screen opens
    Then the chase card says "Chase sam on Write the permissions memo"
    And the chase card offers "Chase", "Done" and "Keep waiting"
    And the switch reads "You · 1", "Mayor · 0" and "Factory · 0"
    And there is no Waiting on others section

  Scenario: mw-xpy2ds: Chase tells the factory he chased, once, and the card leaves the queue
    Given a view with a chase need for him
    When the Needs screen opens
    And "Chase" is tapped on the chase card
    Then one action "chase" on the chase bead is delivered
    And the chase card leaves the queue at once

  Scenario: mw-xpy2ds: Done tells the factory the other side delivered
    Given a view with a chase need for him
    When the Needs screen opens
    And "Done" is tapped on the chase card
    Then one action "ask_done" on the chase bead is delivered
    And the chase card leaves the queue at once

  Scenario: mw-xpy2ds: Keep waiting tells the factory to leave it for another three working days
    Given a view with a chase need for him
    When the Needs screen opens
    And "Keep waiting" is tapped on the chase card
    Then one action "keep_waiting" on the chase bead is delivered
    And the chase card leaves the queue at once

  Scenario: mw-xpy2ds: a waiting need on a bead's page says who and since when, with no buttons
    Given a view with a question for him and a bead waiting on others
    When the bead's page opens
    Then the page shows "Waiting on sam (tl) since 9 Oct 12:00 UTC" and no Done button

  Scenario: mw-xpy2ds: protocol.md's Needs-you table lists waiting and chase, and §13 lists the three answers
    Given docs/protocol.md
    Then its Needs-you table lists the kinds "waiting" and "chase"
    And its actions table lists "chase", "ask_done" and "keep_waiting"
    And it says the others word of waits_for is not read as you
