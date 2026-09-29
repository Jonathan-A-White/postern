Feature: Talk archives the threads of finished beads, and he can archive or bring back any thread (mw-2y46l.6)

  Scenario: mw-2y46l.6: a closed bead's thread quiet 4 days is under Archived, one quiet 1 day is not
    Given the bead "mw-a.1" is closed and the bead "mw-a.2" is closed
    And the thread of "mw-a.1" was last spoken in "4" days ago
    And the thread of "mw-a.2" had its last word "1" days ago
    When Talk opens
    Then the thread list shows "mw-a.2" and not "mw-a.1"
    And an "Archived (1)" row is shown
    When the "Archived (1)" row is tapped
    Then the archived list shows "mw-a.1"

  Scenario: mw-2y46l.6: a bead the view no longer lists is treated as closed
    Given the view lists no bead "mw-z.1"
    And the thread of "mw-z.1" was last spoken in "4" days ago
    When Talk opens
    Then an "Archived (1)" row is shown

  Scenario: mw-2y46l.6: an open bead's thread is never auto-archived
    Given the bead "mw-b.1" is open
    And the thread of "mw-b.1" was last spoken in "30" days ago
    When Talk opens
    Then the thread list shows "mw-b.1"
    And no Archived row is shown

  Scenario: mw-2y46l.6: a hand-archived thread moves to Archived and Unarchive brings it back
    Given the bead "mw-c.1" is open
    And the thread of "mw-c.1" was last spoken in "1" days ago
    When Talk opens
    And the thread "mw-c.1" is archived from its row
    Then the thread list shows nothing of "mw-c.1"
    And an "Archived (1)" row is shown
    When the "Archived (1)" row is tapped
    And Unarchive is tapped on "mw-c.1"
    Then the thread list shows "mw-c.1"
    And no Archived row is shown

  Scenario: mw-2y46l.6: a thread opened on its own screen can be archived from there
    Given the bead "mw-c.2" is open
    And the thread of "mw-c.2" was last spoken in "1" days ago
    When the thread "mw-c.2" is opened and its Archive control is tapped
    Then the thread list shows nothing of "mw-c.2"
    And an "Archived (1)" row is shown

  Scenario: mw-2y46l.6: a new message un-archives a thread
    Given the bead "mw-d.1" is closed
    And the thread of "mw-d.1" was last spoken in "5" days ago
    When Talk opens
    Then an "Archived (1)" row is shown
    When a new message arrives on the thread of "mw-d.1"
    Then the thread list shows "mw-d.1"
    And no Archived row is shown

  Scenario: mw-2y46l.6: a new message un-archives a thread he archived by hand
    Given the bead "mw-d.2" is open
    And the thread of "mw-d.2" was last spoken in "1" days ago
    When Talk opens
    And the thread "mw-d.2" is archived from its row
    And a new message arrives on the thread of "mw-d.2"
    Then the thread list shows "mw-d.2"
    And no Archived row is shown

  Scenario: mw-2y46l.6: Factory never archives
    Given the general thread was last spoken in "40" days ago
    When Talk opens
    Then the thread list shows "Factory"
    And Factory has no Archive control

  Scenario: mw-2y46l.6: search finds an archived thread
    Given the bead "mw-e.1" is closed
    And the thread of "mw-e.1" was last spoken in "9" days ago
    When Talk opens
    And "mw-e.1" is typed into the thread search
    Then the live list has no "mw-e.1"
    And the archived list shows "mw-e.1"
