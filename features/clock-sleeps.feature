Feature: No clock ticks while Postern is in the background (mw-xhtcup.1)

  Scenario: AC-1: while Postern is in the background no clock ticks; on return the times are fresh
    Given Postern shows a time that is a minute old
    When Postern goes to the background for five minutes
    Then no clock is running and the time has not been redrawn
    When Postern comes back to the foreground
    Then the time reads "6 min ago" at once
    And one clock is running again

  Scenario: AC-2: the Later-tap drain does not run in the background and runs once on return
    Given the Later-tap drain is running every 15 seconds
    When Postern goes to the background for five minutes
    Then the drain has not run
    When Postern comes back to the foreground
    Then the drain has run once
