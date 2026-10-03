Feature: The Talk presence poll is gentle with the phone's battery (mw-1ox07o.4)

  Scenario: mw-1ox07o.4 AC-1: while the line waits for the Mayor the presence is asked every 5 s
    Given the Talk screen is open and the line is waiting for the Mayor
    When 31 seconds pass
    Then the presence was asked 7 times

  Scenario: mw-1ox07o.4 AC-2: while the line is not waiting the presence is asked every 30 s
    Given the Talk screen is open and the line is idle
    When 95 seconds pass
    Then the presence was asked 4 times

  Scenario: mw-1ox07o.4 AC-3: a hidden page asks nothing, and asks at once when it is visible again
    Given the Talk screen is open and the line is waiting for the Mayor
    When the page is hidden and 120 seconds pass
    Then the presence was asked 1 time
    When the page becomes visible
    Then the presence was asked 2 times

  Scenario: mw-1ox07o.4 AC-4: the poll slows to 30 s when the wait ends, and the timer is cleared when the screen closes
    Given the Talk screen is open and the line is waiting for the Mayor
    When the line stops waiting and 65 seconds pass
    Then the presence was asked 4 times
    When the Talk screen closes and 120 seconds pass
    Then the presence has still been asked 4 times
