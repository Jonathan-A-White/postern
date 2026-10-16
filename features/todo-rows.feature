Feature: The To do board opens on Do now and Make time, with Later and Let go folded under them (mw-ht6gsw.5)

  Scenario: mw-ht6gsw.5 AC-1: cards in the rows now, now, make-time, later, later and let-go show Do now, Make time, and Later and Let go folded with their counts
    Given a view with a list "mw-a" whose cards are in the rows "now, now, later"
    And a second list "mw-b" whose cards are in the rows "make-time, later, let-go"
    When the To do tab opens as he first finds it
    Then the row "Do now" shows "Title of mw-a.1" then "Title of mw-a.2"
    And the row "Make time" shows only "Title of mw-b.1"
    And "Later · 2" is folded
    And "Let go · 1" is also folded
    And no card of the rows "Later" or "Let go" is shown

  Scenario: mw-ht6gsw.5 AC-1: opening Later shows the two list columns with their Later cards, and folding it hides them
    Given a view with a list "mw-a" whose cards are in the rows "now, now, later"
    And a second list "mw-b" whose cards are in the rows "make-time, later, let-go"
    When the To do tab opens as he first finds it
    And he opens "Later · 2"
    Then the board has the columns "Title of mw-a" and "Title of mw-b"
    And the list "Title of mw-a" shows only "Title of mw-a.3"
    And the list "Title of mw-b" likewise shows only "Title of mw-b.2"
    When he folds "Later · 2"
    Then "Later · 2" is folded
    And no card of the rows "Later" or "Let go" is shown

  Scenario: mw-ht6gsw.5 AC-1: opening Let go shows its card with Keep and Drop
    Given a view with a list "mw-a" whose cards are in the rows "now, now, later"
    And a second list "mw-b" whose cards are in the rows "make-time, later, let-go"
    When the To do tab opens as he first finds it
    And he opens "Let go · 1"
    Then the card "Title of mw-b.3" in Let go offers Keep and Drop

  Scenario: mw-ht6gsw.5 AC-1: Keep sends a todo_edit with row later and the card moves to Later at once
    Given a view with a list "mw-a" whose cards are in the rows "now, now, later"
    And a second list "mw-b" whose cards are in the rows "make-time, later, let-go"
    When the To do tab opens as he first finds it
    And he opens "Let go · 1"
    And he taps Keep on "Title of mw-b.3"
    Then a todo_edit for "mw-b.3" with row "later" and nothing else waits in the outbox
    And "Later · 3" is folded
    And no Let go row is shown

  Scenario: mw-ht6gsw.5 AC-1: Drop sends a close with the reason let-go and says it waits for the Mayor
    Given a view with a list "mw-a" whose cards are in the rows "now, now, later"
    And a second list "mw-b" whose cards are in the rows "make-time, later, let-go"
    When the To do tab opens as he first finds it
    And he opens "Let go · 1"
    And he taps Drop on "Title of mw-b.3"
    Then a close for "mw-b.3" with the reason "let-go" waits in the outbox
    And the card "Title of mw-b.3" in Let go says "Dropped, waiting for the Mayor" and offers neither Keep nor Drop

  Scenario: mw-ht6gsw.5 AC-1: a card with no todo_row is under Later
    Given a view with a list "mw-a" whose cards are in the rows "none, none"
    When the To do tab opens as he first finds it
    Then "Later · 2" is folded
    And the row "Do now" says "Nothing due soon"
    And the row "Make time" also says "Nothing waiting"
    When he opens "Later · 2"
    Then the list "Title of mw-a" shows only "Title of mw-a.1" then "Title of mw-a.2"

  Scenario: mw-ht6gsw.5 AC-1: a fourth now card goes to Later, the three due soonest staying in Do now
    Given a view with a list "mw-a" whose cards are in the rows "now, now, now, now"
    And the card "mw-a.4" is due tomorrow
    And the card "mw-a.1" is due in 2 days
    And the card "mw-a.2" is due in 3 days
    And the card "mw-a.3" is due in 4 days
    When the To do tab opens as he first finds it
    Then the row "Do now" shows "Title of mw-a.4" then "Title of mw-a.1" then "Title of mw-a.2"
    And "Later · 1" is folded
    When he opens "Later · 1"
    Then the list "Title of mw-a" shows only "Title of mw-a.3"

  Scenario: mw-ht6gsw.5 AC-2: a card's back shows the pass's why under its title
    Given a view with a list "mw-a" whose cards are in the rows "now, later"
    And the card "mw-a.1" has the why "Due Friday and starred"
    When the To do tab opens as he first finds it
    And he turns "Title of mw-a.1" over
    Then the back of "Title of mw-a.1" shows the why "Due Friday and starred"

  Scenario: mw-ht6gsw.5 AC-1: a card in Do now names its list, and shows its star, due time and size
    Given a view with a list "mw-a" whose cards are in the rows "now, later"
    And the card "mw-a.1" is due tomorrow
    And the card "mw-a.1" is important
    And the card "mw-a.1" is of size "hour"
    When the To do tab opens as he first finds it
    Then the card "Title of mw-a.1" in Do now names its list "Title of mw-a", is starred, shows a due time and the size mark "1h"

  Scenario: mw-ht6gsw.5 AC-3: the Today tap on a card in Later puts it first in its column for that day only
    Given a view with a list "mw-a" whose cards are in the rows "later, later"
    When the To do tab opens as he first finds it
    And he opens "Later · 2"
    And he turns "Title of mw-a.2" over
    And he taps "Move to Today" on the card's back
    And he taps Back on the card
    Then the list "Title of mw-a" shows only "Title of mw-a.2" then "Title of mw-a.1"
    When it is the next day and the To do tab is opened again
    Then the list "Title of mw-a" again shows only "Title of mw-a.1" then "Title of mw-a.2"
