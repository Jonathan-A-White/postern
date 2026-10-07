Feature: The Key screen asks WhatsOnChain for each thing once (mw-nlxylg)

  Scenario: mw-nlxylg AC-2: opening the Key screen reads each address list and each transaction once
    Given a key whose address holds 5 transactions on one page of WhatsOnChain's history
    When the Key screen is opened
    Then WhatsOnChain was asked 8 times: the coins, both address lists and the 5 transactions
    And no address list and no transaction was asked for twice

  Scenario: mw-nlxylg AC-2b: opening the Key screen again asks for no transaction a second time
    Given a key whose address holds 5 transactions on one page of WhatsOnChain's history
    And the Key screen was opened
    When the Key screen is opened again
    Then WhatsOnChain was asked 3 times: the coins and both address lists

  Scenario: mw-nlxylg AC-2c: a transaction that could not be read is asked for again, the others are not
    Given a key whose address holds 5 transactions on one page of WhatsOnChain's history
    And WhatsOnChain cannot give one of the transactions
    And the Key screen was opened
    When WhatsOnChain can give it again and the Issued licences are retried
    Then only the transaction that failed, and the ones not yet read, are asked for
