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
    And no licence and no pending mint are cached

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

  Scenario: mw-1589l.25 AC1: a licensed key is not asked to mint again
    Given a key already holds a licence
    When the key screen is opened and unlocked
    Then the screen says "Licensed" instead of asking to fund or mint
    And the balance and "Refresh balance" are still shown

  Scenario: mw-1589l.26 AC1: the mint block offers a collapsed "What is a licence?" explanation
    Given the key screen is opened
    When a new key is generated and the phrase is confirmed
    Then a "What is a licence?" control is offered, collapsed
    When "What is a licence?" is opened
    Then the explanation names the licence, the key and the mint cost from the code

  Scenario: mw-1589l.26 AC3: a licensed key shows no mint block and no explanation control
    Given a key already holds a licence
    When the key screen is opened and unlocked
    Then no "What is a licence?" control is offered

  Scenario: mw-kiubh7.1 AC1: a licence in the old collection says so and offers the mint in postern
    Given a key already holds a licence in the old collection
    When the key screen is opened and unlocked
    Then the screen says "Licensed" and that the licence is in the old collection
    And "Mint my licence in postern" is offered and "Mint my licence (testnet)" is not

  Scenario: mw-kiubh7.1 AC2: a licence in postern shows no mint button
    Given a key already holds a licence in postern
    When the key screen is opened and unlocked
    Then the screen says "Licensed" with no mint button of either kind

  Scenario: mw-7ijx65 AC1: a mint still waiting for the chain shows its txid and no mint button
    Given a key has sent a mint the chain has not shown yet
    When the key screen is opened and unlocked
    Then the screen says "Minted:" with that txid and ", waiting for the chain"
    And no mint button of either kind is offered

  Scenario: mw-7ijx65 AC2: a licence check that cannot reach WhatsOnChain says so and offers no mint
    Given a key whose licence check cannot reach WhatsOnChain
    When the key screen is opened and unlocked
    Then the screen says the licence could not be checked
    And no mint button of either kind is offered
    And "Check the licence again" is offered

  Scenario: mw-7ijx65 AC3: a stale cache that says no licence does not hide a licence in the old collection
    Given a key whose cached status says no licence but whose chain holds one in the old collection
    When the key screen is opened and unlocked
    Then the screen says "Licensed" and that the licence is in the old collection
