Feature: Every bead id in a message or card is a link (mw-tbx1n.11)

  Scenario: mw-tbx1n.11: a bead id in a Talk message is a link to that bead's page
    Given the Mayor's message in the general thread is "Landed mw-6ww.48, then `mw-x` stays text"
    When the general thread is opened
    Then the message shows a link "mw-6ww.48" to the bead page of "mw-6ww.48" and no link for "mw-x"

  Scenario: mw-gq6.223: the Read aloud control speaks a message without its bead ids while the screen keeps the chips
    Given the Mayor's message in the general thread is "Running now: mw-nqur1n.10, mw-j0f2d.30. Next mw-gq6.222 lands."
    When the general thread is opened and Read aloud is tapped on the message
    Then the phone speaks aloud "Running now. Next lands."
    And the message still shows links "mw-nqur1n.10", "mw-j0f2d.30" and "mw-gq6.222"
