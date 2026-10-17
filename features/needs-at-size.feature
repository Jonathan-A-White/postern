Feature: Needs you opens at the size of the live view (mw-ev7oyy.43)

  On 2026-10-17 a tap on Needs you froze his phone for good: the view held 1067 needs and 1252
  beads, and every card decoded the whole stored view again, several times over.

  Scenario: mw-ev7oyy.43: Needs you with 150 cards decodes the stored view once, not once a card
    Given a stored view of the live view's shape with 150 needs, none folded
    When Needs you opens inside the shell
    Then every card waiting on him is shown
    And the stored view was decoded once
