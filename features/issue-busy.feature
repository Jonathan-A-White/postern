Feature: Issue retries a busy WhatsOnChain and says plainly whether anything was spent (mw-rch8bu)

  Scenario: mw-rch8bu AC-1: a 429 on the coin list is tried again, the screen says so, and the licence is issued
    Given the backend relays WhatsOnChain's 429 page twice when it lists the coins
    And the Key screen of an issuer is open
    When I issue a licence to one key
    Then the screen says WhatsOnChain is busy and it is trying again
    And the licence is issued on the third try
    And the screen shows no error

  Scenario: mw-rch8bu AC-2: a 429 that does not clear ends in one plain line, with no page and nothing spent
    Given the backend relays WhatsOnChain's 429 page every time it lists the coins
    And the Key screen of an issuer is open
    When I issue a licence to one key
    Then the screen says WhatsOnChain is rate-limiting us, nothing was spent, try again in a minute
    And the coins were asked for four times
    And the screen shows none of WhatsOnChain's page
    And the page went to the console

  Scenario: mw-rch8bu AC-3: a 429 on the broadcast is sent again, and when it does not clear nothing was spent
    Given the backend relays WhatsOnChain's 429 page every time it broadcasts
    And the Key screen of an issuer is open
    When I issue a licence to one key
    Then the screen says WhatsOnChain is rate-limiting us, nothing was spent, try again in a minute
    And the broadcast was tried four times

  Scenario: mw-rch8bu AC-4: a 503 on the broadcast is not sent again, and the screen says it may have gone out and how to check
    Given the backend relays WhatsOnChain's 503 when it broadcasts
    And the Key screen of an issuer is open
    When I issue a licence to one key
    Then the screen says the licence may have gone out and to check Issued licences before issuing again
    And the broadcast was tried once

  Scenario: mw-rch8bu AC-5: a long unbroken error wraps instead of running off the screen
    Given the backend answers a coin list refusal of 200 unbroken characters
    And the Key screen of an issuer is open
    When I issue a licence to one key
    Then the error wraps anywhere

  Scenario: mw-nxj49n AC-3: the backend's short 429 reply, with no page in it, is tried again like any other 429
    Given the backend answers WhatsOnChain's 429 with only its status when it lists coins
    And the Key screen of an issuer is open
    When I issue a licence to one key
    Then the screen says WhatsOnChain is rate-limiting us, nothing was spent, try again in a minute
    And the coins were asked for four times

  Scenario: mw-nxj49n AC-3: a plain 500 on the broadcast is not busy, so it is not sent again, and the screen says it may have gone out
    Given the backend relays WhatsOnChain's 500 when it broadcasts
    And the Key screen of an issuer is open
    When I issue a licence to one key
    Then the screen says the licence may have gone out and to check Issued licences before issuing again
    And the broadcast was tried once
