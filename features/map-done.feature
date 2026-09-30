Feature: The Map folds finished maps and epics into a closed "Done · N" section (mw-tbx1n.13)

  Scenario: mw-tbx1n.13: Done · 1 opens to show the finished epic
    Given an epic "mw-x" whose only child is closed and an epic "mw-y" with an open child
    When the Map opens
    Then the Epics section lists "mw-y" and not "mw-x"
    And a "Done · 1" button is shown, closed
    When the "Done · 1" button is tapped
    Then the Done section lists "mw-x"

  Scenario: mw-tbx1n.13: a new open child brings a finished epic back by itself
    Given an epic "mw-x" whose only child is closed and an epic "mw-y" with an open child
    When the Map opens
    Then a "Done · 1" button is shown, closed
    When a new open child is filed under "mw-x"
    Then the Epics section lists "mw-x" and "mw-y"
    And no Done button is shown
