Feature: Revoke retries a busy WhatsOnChain and says plainly whether anything was spent (mw-2f65hu)

  Scenario: mw-2f65hu AC-1: a 429 on the coin list is tried again, the row says so, and the licence ends revoked
    Given the backend relays WhatsOnChain's 429 page twice when it lists the coins
    And the Key screen of an issuer with one held licence is open
    When I revoke that licence
    Then the row says WhatsOnChain is busy and it is trying again
    And the revoke is broadcast on the third try
    And the licence is shown revoked

  Scenario: mw-2f65hu AC-1: a 429 on the broadcast is sent again and the licence ends revoked
    Given the backend relays WhatsOnChain's 429 page twice when it broadcasts
    And the Key screen of an issuer with one held licence is open
    When I revoke that licence
    Then the row says WhatsOnChain is busy and it is trying again
    And the licence is shown revoked
    And the broadcast was tried three times

  Scenario: mw-2f65hu AC-2: a 429 on the coin list that does not clear ends in one plain line, with nothing spent
    Given the backend relays WhatsOnChain's 429 page every time it lists the coins
    And the Key screen of an issuer with one held licence is open
    When I revoke that licence
    Then the row says WhatsOnChain is rate-limiting us, nothing was spent, try again in a minute
    And the coins were asked for four times
    And the screen shows none of WhatsOnChain's page and no "said 429"
    And nothing was broadcast

  Scenario: mw-2f65hu AC-2: a 429 on the broadcast that does not clear says nothing was spent
    Given the backend relays WhatsOnChain's 429 page every time it broadcasts
    And the Key screen of an issuer with one held licence is open
    When I revoke that licence
    Then the row says WhatsOnChain is rate-limiting us, nothing was spent, try again in a minute
    And the broadcast was tried four times
    And the screen shows none of WhatsOnChain's page and no "said 429"
    And the row keeps Confirm revoke

  Scenario: mw-2f65hu AC-2: a 503 on the broadcast is not sent again, and the row says the revoke may have gone out
    Given the backend relays WhatsOnChain's 503 when it broadcasts
    And the Key screen of an issuer with one held licence is open
    When I revoke that licence
    Then the row says the revoke may have gone out and to check its status before revoking it again
    And the broadcast was tried once
