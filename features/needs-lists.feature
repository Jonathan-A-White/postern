Feature: Needs you splits what waits on him from what waits on the Mayor or the factory (mw-tbx1n.8)

  Scenario: mw-tbx1n.8: a card waiting on the Mayor is under Mayor, not You, and has no Done
    Given a view with a question for him, a step waiting on the Mayor and a step waiting on the factory
    When the Needs screen opens
    Then the switch reads "You · 1", "Mayor · 1" and "Factory · 1"
    And the You list shows the question and neither step
    When "Mayor · 1" is tapped
    Then the address names the Mayor's list
    And the Mayor card says "Waits on the Mayor", has no Done button, and keeps Reply and Open
    When the switch is moved on to "Factory · 1"
    Then the Factory card says "Waits on the factory", names "Build the runner", and has no Done button

  Scenario: mw-tbx1n.8: the badge counts only You
    Given a view with a question for him, a step waiting on the Mayor and a step waiting on the factory
    When the Needs screen opens inside the shell
    Then the Needs you tab badge reads "1"

  Scenario: mw-tbx1n.8: a link with who=mayor opens the Mayor's list
    Given a view with a question for him, a step waiting on the Mayor and a step waiting on the factory
    When the address is "?v=needs&who=mayor" and the Needs screen opens
    Then "Mayor · 1" is the chosen part and its card is shown

  Scenario: mw-ev7oyy.3: folded verify cards sit in one closed line at the foot, and a tap opens them
    Given a view with a question for him, a verify card and a folded verify card
    When the Needs screen opens
    Then the You list shows the question and the verify card but not the folded one
    And the foot reads "Waiting on your use (1)" and is closed
    When the foot line is tapped
    Then the folded verify card is shown with a Verified button

  Scenario: mw-ev7oyy.3: the badge leaves the folded verify cards out
    Given a view with a question for him, a verify card and a folded verify card
    When the Needs screen opens inside the shell
    Then the Needs you tab badge reads "2"
