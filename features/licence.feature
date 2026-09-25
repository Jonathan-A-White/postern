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

  Scenario: AC-5: an unfunded key names the sats it needs to mint
    Given the key screen is opened
    When a new key is generated and the phrase is confirmed
    Then the screen shows the key's testnet address and a balance of 0 sats
    And the screen says it needs 10,008 testnet sats sent to that address

  Scenario: AC-6: a balance lookup failure names the reason and offers Retry
    Given the key screen is opened
    And the chain is unreachable
    When a new key is generated and the phrase is confirmed
    Then the screen shows balance unavailable from WhatsOnChain naming the reason
    And a "Retry" control is offered

  Scenario: AC-7: retrying after funding the key enables the mint button
    Given the key screen is opened
    And the chain is unreachable
    When a new key is generated and the phrase is confirmed
    And the chain is funded with 20,000 sats and "Retry" is chosen
    Then the "Mint my licence (testnet)" button is enabled

  Scenario: mw-1589l.22 AC2a: a balance of exactly the Fuel plus the License leaves Mint disabled
    Given the key screen is opened
    And the key is restored from a phrase funded with exactly the Fuel plus the License token
    Then the "Mint my licence (testnet)" button is disabled

  Scenario: mw-1589l.22 AC2b: a balance covering the mint's stated cost enables Mint
    Given the key screen is opened
    And the key is restored from a phrase funded with exactly the mint's stated cost
    Then the "Mint my licence (testnet)" button is enabled
