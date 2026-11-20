Feature: The line goes back to Live by itself once the backend answers again (mw-gq6.1570)

  His report, 2026-11-20: the badge said "Live from the chain" after the Laptop's load had passed, and only closing and
  reopening the app brought back Live. The phone's own calls sent while the backend did not answer wait out their 30 s,
  and the loop then waits out its back-off, so Live came back a minute or more after the backend did.

  Scenario Outline: mw-gq6.1570 AC-1: the stream was live, the backend stopped answering for <outage> seconds and the chain took over; once it answers again the badge reads Live within the back-off, with no reload
    Given the factory is connected and the event stream is live
    When the backend stops answering
    And <outage> seconds pass
    Then the badge shows "Live from the chain"
    When the backend answers again
    And 30 seconds pass
    Then the connection reads "live"
    And the badge shows "Live"

    Examples:
      | outage |
      | 180    |
      | 220    |
      | 250    |
      | 285    |
      | 300    |
