Feature: One fingerprint unlock carries across a real screen change

  Scenario: AC3: unlocking on the Projects screen carries through a project, a bead and the Send screen, until Lock
    Given a PRF-wrapped vault exists with one project and one landed item
    And the Projects screen is opened and unlocked with a fingerprint
    When the project is opened by tapping its row
    Then the project screen shows no fingerprint prompt
    When the landed item is opened by tapping its row
    Then the bead screen shows no fingerprint prompt
    When the browser's Back button returns to the root and "Send a message" is opened
    Then the Send screen shows no fingerprint prompt
    When "Lock" is tapped on the Send screen
    And the browser's Back button returns to the root and "Send a message" is opened again
    Then the Send screen offers to unlock with your fingerprint

  Scenario: AC3 (mw-tfne4.29): tapping the Projects screen's own "Back" link to the home screen keeps the shared unlock
    Given a PRF-wrapped vault exists with one project and one landed item
    And the Projects screen is opened and unlocked with a fingerprint
    When the "Back" link is tapped to return to the home screen
    And "Send a message" is opened
    Then the Send screen shows no fingerprint prompt
