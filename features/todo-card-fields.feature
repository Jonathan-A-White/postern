Feature: A To do card's back shows its size and its Then line, each a tap to change (mw-ht6gsw.4)

  Scenario: mw-ht6gsw.4 AC-1: a card the view gives the size hour shows 1h on its front and an Hour marked on its back
    Given a view with a card "mw-list.1" of size "hour"
    When the To do tab opens
    Then the front of "Title of mw-list.1" shows the size mark "1h"
    And the front of "Title of mw-list.2" shows no size mark
    When he turns "Title of mw-list.1" over
    Then the size "an Hour" is marked on the back of "Title of mw-list.1"
    And the sizes "Quick" and "a Half day" are not marked

  Scenario: mw-ht6gsw.4 AC-1: a tap on Quick sends todo_edit with size quick and the card shows Q at once
    Given a view with a card "mw-list.1" of size "hour"
    When the To do tab opens
    And he turns "Title of mw-list.1" over
    And he taps the size "Quick"
    Then a todo_edit for "mw-list.1" with size "quick" and nothing else waits in the outbox
    And the size "Quick" is marked on the back of "Title of mw-list.1"
    When he turns "Title of mw-list.1" back
    Then the front of "Title of mw-list.1" shows the size mark "Q"

  Scenario: mw-ht6gsw.4 AC-1: a tap on a card that has no size yet sets it, and a half day shows half
    Given a view with a card "mw-list.1" of size "hour"
    When the To do tab opens
    And he turns "Title of mw-list.2" over
    And he taps the size "a Half day"
    Then a todo_edit for "mw-list.2" with size "half-day" and nothing else waits in the outbox
    When he turns "Title of mw-list.2" back
    Then the front of "Title of mw-list.2" shows the size mark "half"

  Scenario: mw-ht6gsw.4 AC-1: a tap on the marked size sends size empty and the mark goes
    Given a view with a card "mw-list.1" of size "hour"
    When the To do tab opens
    And he turns "Title of mw-list.1" over
    And he taps the size "an Hour"
    Then a todo_edit for "mw-list.1" with size "" and nothing else waits in the outbox
    And no size is marked on the back of "Title of mw-list.1"
    When he turns "Title of mw-list.1" back
    Then the front of "Title of mw-list.1" shows no size mark

  Scenario: mw-ht6gsw.4 AC-1: a Then line typed and confirmed sends todo_edit with then and shows on the back
    Given a view with a card "mw-list.1" of size "hour"
    When the To do tab opens
    And he turns "Title of mw-list.2" over
    Then the back of "Title of mw-list.2" has an empty follow-up line and a dead Save button
    When he types the Then line "Book the plumber"
    And he confirms the Then line
    Then a todo_edit for "mw-list.2" with then "Book the plumber" and nothing else waits in the outbox
    And the follow-up line on the back of "Title of mw-list.2" reads "Book the plumber"

  Scenario: mw-ht6gsw.4 AC-1: a Then line the view carries shows on the back and clearing it sends then empty
    Given a view with a card "mw-list.1" of size "hour"
    And the card "mw-list.1" has the Then line "Send the invoice"
    When the To do tab opens
    And he turns "Title of mw-list.1" over
    Then the follow-up line on the back of "Title of mw-list.1" reads "Send the invoice"
    When he clears the Then line
    And he confirms the Then line
    Then a todo_edit for "mw-list.1" with then "" and nothing else waits in the outbox

  Scenario: mw-ht6gsw.4 AC-1: a Then line over 200 characters is kept whole, says it is too long and cannot be saved
    Given a view with a card "mw-list.1" of size "hour"
    When the To do tab opens
    And he turns "Title of mw-list.2" over
    And he pastes a follow-up line of 201 characters
    Then the back of "Title of mw-list.2" says the line is too long and its Save button is dead
    And the whole 201 characters are still in the field
