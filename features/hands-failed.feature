Feature: A failed step for his hands says Failed and why

  Scenario: mw-t64a3.10: a step that failed shows Failed and the reason, and can be run again
    Given a step for his hands that failed with the reason "could not start: no such host"
    When the step is shown
    Then the card says "Failed" and the reason "could not start: no such host"
    And the card still offers "Approve and run again"

  Scenario: mw-t64a3.10: a failed step with no reason reads as before
    Given a step for his hands that failed with exit 2 and no reason
    When the step is shown
    Then the card says "failed, exit 2" and not "Failed"
