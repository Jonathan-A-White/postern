Feature: A step that waits cannot be tapped (mw-tbx1n.9)

  Scenario: mw-tbx1n.9: a step whose bead waits shows Waits on: <title> and no Approve and run
    Given a step for his hands whose bead waits on the open bead "Build the runner"
    When the Needs screen opens on the Factory list
    Then the step says "Waits on: Build the runner" with the title a link to that bead
    And the step offers no "Approve and run", "Approve and run again", "I did it myself" or "Done"

  Scenario: mw-tbx1n.9: on the bead's page too
    Given a step for his hands whose bead waits on the open bead "Build the runner"
    When the bead's page opens
    Then the step says "Waits on: Build the runner" with the title a link to that bead
    And the step offers no "Approve and run", "Approve and run again", "I did it myself" or "Done"

  Scenario: mw-tbx1n.9: a step that failed on a bead that now waits cannot be run again
    Given a step for his hands that failed, whose bead now waits on the open bead "Build the runner"
    When the bead's page opens
    Then the step says "Waits on: Build the runner" with the title a link to that bead
    And the step offers no "Approve and run", "Approve and run again", "I did it myself" or "Done"

  Scenario: mw-tbx1n.9: a step whose bead waits on nothing is tapped as before
    Given a step for his hands whose bead waits on nothing
    When the bead's page opens
    Then the step offers "Approve and run" and "I did it myself" and says nothing of waiting
