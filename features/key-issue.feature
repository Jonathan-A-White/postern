Feature: The Key screen shows my public key and issues and revokes licences (mw-yjxcw.4)

  Scenario: AC1: my public key is shown as a QR and as hex when the key is unlocked
    Given my key is unlocked and the backend names two collections
    When the key screen is opened
    Then I see a QR code that encodes my public key
    And I see my public key as hex
    And I can copy it

  Scenario: AC2: Scan is absent when the phone has no BarcodeDetector
    Given my key is unlocked and the backend names two collections
    And this browser has no BarcodeDetector
    When the key screen is opened
    Then there is no Scan button
    And I can still paste a holder's key into the field

  Scenario: AC3: Scan is present with a BarcodeDetector and fills the field with the code it reads
    Given my key is unlocked and the backend names two collections
    And this browser has a BarcodeDetector that reads a holder's key
    When the key screen is opened
    And I press Scan
    Then the holder field holds the key that was read
    And the camera is stopped

  Scenario: AC4: the collection list comes from the backend
    Given my key is unlocked and the backend names two collections
    When the key screen is opened
    Then the collection choices are postern and cairn with its app name

  Scenario: AC5: an app key, with no collections, sees no Issue section
    Given my key is unlocked and the backend names no collections
    When the key screen is opened
    Then there is no Issue a licence section

  Scenario: AC6: Issue calls issueLicence with the typed key and the chosen collection and shows the txid
    Given my key is unlocked and the backend names two collections
    And I hold enough sats to issue
    When the key screen is opened
    And I type a holder's key and choose cairn
    And I press Issue
    Then issueLicence was called with that key and cairn
    And I see the txid of the mint as a testnet link
    And the cost is shown against my balance

  Scenario: AC7: Revoke asks to confirm and then calls revokeLicence
    Given my key is unlocked and the backend names two collections
    And I issued a held licence and a revoked one
    When the key screen is opened
    And I press Revoke on the held licence
    Then nothing is revoked yet and I am asked to confirm
    When I confirm the revoke
    Then revokeLicence was called with that licence's origin

  Scenario: AC8: the row shows revoked afterwards
    Given my key is unlocked and the backend names two collections
    And I issued a held licence and a revoked one
    When the key screen is opened
    And I press Revoke on the held licence
    And I confirm the revoke
    Then both rows show revoked

  Scenario: AC9: issued licences are listed per collection with holder, date, txid link and status
    Given my key is unlocked and the backend names two collections
    And I issued a held licence and a revoked one
    When the key screen is opened
    Then the licences are grouped under their collections
    And each row shows a shortened holder address, its date or block, a txid link to WhatsOnChain testnet and its status
    And only the held row has a Revoke button
