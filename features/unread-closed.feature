Feature: Needs you's 'Unread from the Mayor' leaves out a closed bead's long-quiet thread (mw-mr4xgrw.55)
  A thread whose bead is closed and whose newest message is older than 7 days is not listed there; it stays
  unread in Channels. 'Mark all read' on the section marks every listed thread read.

  Scenario: AC1 and AC3: a closed bead's thread quiet for 8 days is not listed, an open bead's is
    Given an unread thread on a closed bead quiet for 8 days and an unread thread on an open bead quiet for 8 days
    When Needs you is opened
    Then "Unread from the Mayor" lists the open bead's thread and not the closed bead's

  Scenario: AC2: Mark all read marks every listed thread read
    Given an unread thread on an open bead and an unread topic thread
    When Needs you is opened
    And I tap "Mark all read"
    Then both threads are read and "Unread from the Mayor" is gone
