Feature: Every bead id in a message or card is a link (mw-tbx1n.11)

  Scenario: mw-tbx1n.11: a bead id in a Talk message is a link to that bead's page
    Given the Mayor's message in the general thread is "Landed mw-6ww.48, then `mw-x` stays text"
    When the general thread is opened
    Then the message shows a link "mw-6ww.48" to the bead page of "mw-6ww.48" and no link for "mw-x"
