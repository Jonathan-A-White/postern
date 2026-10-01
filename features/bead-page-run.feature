Feature: A hands step on the bead's page can be run from there (mw-gq6.177)

  Scenario: mw-gq6.177: the step's comment on the bead's page has Approve and run under its commands
    Given a hands step on a bead, listed for him and not yet run, with its comment on the bead
    When the bead's page opens
    Then the comment shows "Approve and run" under its commands
