Feature: With the backend out of reach the phone reads the chain itself (mw-a0ih0.5)

  Scenario: AC-1: offline, a ring on chain rings and reopens the line
    Given the phone cannot reach the backend and the Mayor's ring is on chain
    When the phone has been out of reach for a while
    Then WhatsOnChain was asked for the anchor address's history
    And the phone rings with the Mayor's reason
    And the phone asks the backend again at once
    And the Talk line shows the Mayor's reason

  Scenario: AC-2: offline with notifications off, a ring on chain raises a banner and vibrates
    Given the phone cannot reach the backend and the Mayor's ring is on chain
    And notifications are not allowed
    When the phone has been out of reach for a while
    Then the banner says the Mayor is calling, with the reason
    And the phone vibrates
    When he taps Answer on the banner
    Then the Talk line is open on that ring

  Scenario: AC-3: chain polling stops once the event stream is back
    Given the phone cannot reach the backend and the Mayor's ring is on chain
    When the phone has been out of reach for a while
    And the event stream comes back
    Then the connection reads "live"
    And WhatsOnChain is not asked again
