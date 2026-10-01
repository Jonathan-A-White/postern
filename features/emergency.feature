Feature: An emergency record shows at the top of every open screen at once, ahead of pending batches, until he taps it (mw-jrx0s.13)

  Scenario: mw-jrx0s.13: an emergency arriving while batches are pending shows the banner on the Map at once, and a tap clears it and opens the bead
    Given the Map is open on a phone, with a batch of events pending in the same sync
    When the sync pages the Mayor's emergency "Disk is full" about "mw-f758y.30.2" after the pending batch
    Then the banner at the top of the Map says "Disk is full"
    And the pending batch was applied after the emergency
    When he taps the banner
    Then the banner is gone
    And the bead "mw-f758y.30.2" is open

  Scenario: mw-jrx0s.13: an emergency about no bead shows on the Talk screen too, and a tap opens the Talk line
    Given the Talk screen is open on a phone
    When the sync pages the Mayor's emergency "Call me now" about no bead
    Then the banner at the top of the Talk screen says "Call me now"
    When he taps the banner
    Then the banner is gone
    And the Talk line is open

  Scenario: mw-jrx0s.13: a cleared emergency stays cleared after the app opens again
    Given the Map is open on a phone, with a batch of events pending in the same sync
    When the sync pages the Mayor's emergency "Disk is full" about "mw-f758y.30.2" after the pending batch
    And he taps the banner
    And the app is opened again on the Map
    Then the banner is gone

  Scenario: mw-jrx0s.13: an emergency that was paged before is not applied twice when the ordinary batches follow
    Given the Map is open on a phone, with a batch of events pending in the same sync
    When the sync pages the Mayor's emergency "Disk is full" about "mw-f758y.30.2" after the pending batch
    Then every event was kept once and the cursor is at the last
