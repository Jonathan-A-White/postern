Feature: Minting a licence

  Scenario: AC-1: mint is not offered while the key is locked
    Given a phrase-wrapped vault exists from a previously generated key
    When the key screen is reopened
    Then no "Mint my licence (testnet)" button is shown

  Scenario: AC-2: mint is disabled while unlocked with no testnet balance
    Given the key screen is opened
    When a new key is generated and the phrase is confirmed
    Then the "Mint my licence (testnet)" button is disabled

  Scenario: AC-3: minting succeeds, shows the txid, and the gate opens on the next check
    Given the key screen is opened
    And the key is restored from a phrase whose testnet balance covers the mint
    When "Mint my licence (testnet)" is chosen
    Then the txid is shown with a link to WhatsOnChain testnet
    And the gate opens on the next check

  Scenario: AC-4: a broadcast failure is shown and nothing is cached
    Given the key screen is opened
    And the key is restored from a phrase whose testnet balance covers the mint
    And the provider will fail to broadcast
    When "Mint my licence (testnet)" is chosen
    Then the provider's error is shown in words
    And nothing is cached
