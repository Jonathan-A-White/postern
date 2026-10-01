Feature: With the backend out of reach the phone reads the factory's events from the chain (mw-jrx0s.9)

  Scenario: mw-jrx0s.9 AC-1: offline, an events transaction on the address updates the Map and the status line says so
    Given the phone cannot reach the backend and the Map shows "mw-ch.1" ready
    When an events transaction that starts "mw-ch.1" is on the anchor address and the phone reads the chain
    Then the Map shows 1 working
    And the status line reads "Live from the chain"

  Scenario: mw-jrx0s.9 AC-2: a batch seen on both roads applies once
    Given the phone cannot reach the backend and the Map shows "mw-ch.1" ready
    When an events transaction that starts "mw-ch.1" is on the anchor address and the phone reads the chain
    Then the Map shows 1 working
    When the backend later pages the same batch
    Then the batch was applied once
    And the events cursor is at 1

  Scenario: mw-jrx0s.9 AC-3: a gap on the chain road is tolerated, with no view fetched
    Given the phone cannot reach the backend and the Map shows "mw-ch.1" ready
    When an events transaction that starts at seq 5 is on the anchor address and the phone reads the chain
    Then the Map shows 1 working
    And the view was not fetched

  Scenario: mw-jrx0s.9 AC-4: on reconnect the chain reader stops and paging resumes
    Given the phone cannot reach the backend and the Map shows "mw-ch.1" ready
    When an events transaction that starts "mw-ch.1" is on the anchor address and the phone reads the chain
    Then the Map shows 1 working
    When the event stream comes back and the backend pages the next batch
    Then the connection reads "live"
    And the status line reads "Live"
    And the next batch is applied from the backend
    And WhatsOnChain is not asked again
