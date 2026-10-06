Feature: After an outage the phone goes back to the backend by itself (mw-gq6.276)

  Scenario: mw-gq6.276 AC-1: the app opens while the backend does not answer, and once it answers the line is Live and what waited goes by the direct road
    Given the app opens while the backend does not answer and the chain does
    And he sends "Are you there?"
    When 30 seconds pass
    Then the badge shows "Live from the chain"
    And the message "Are you there?" is queued and not sent
    When the backend answers again
    And 1 minute passes
    Then the connection reads "live"
    And the badge shows "Live"
    And the message "Are you there?" went by the direct road
