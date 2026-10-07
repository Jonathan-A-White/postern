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
    And I confirm the issue
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

  Scenario: AC10: a failed /api/me says so, and Retry with a good answer shows the Issue section
    Given my key is unlocked and the backend fails to answer /api/me
    When the key screen is opened
    Then I see that the collections could not be read and a Retry button
    And there is no Issue a licence section
    When the backend answers /api/me with two collections and I press Retry
    Then the Issue a licence section is shown
    And the collections message is gone

  Scenario: AC11: an app key with a good answer and no collections shows neither the section nor a message
    Given my key is unlocked and the backend names no collections
    When the key screen is opened
    Then there is no Issue a licence section
    And there is no collections message and no Retry button

  Scenario: AC12: Issue asks once before spending, and only Confirm issue calls issueLicence
    Given my key is unlocked and the backend names two collections
    When the key screen is opened
    And I type a holder's key and choose cairn
    And I press Issue
    Then I am asked to issue to the shortened key in cairn for about the mint cost in sats
    And issueLicence has not been called
    When I confirm the issue
    Then issueLicence was called with that key and cairn

  Scenario: AC13: Cancel on the Issue confirm calls nothing
    Given my key is unlocked and the backend names two collections
    When the key screen is opened
    And I type a holder's key and choose cairn
    And I press Issue
    And I cancel the issue
    Then issueLicence has not been called
    And the confirm is gone and the Issue button is back

  Scenario: AC14: two taps of Confirm issue in one tick call issueLicence once
    Given my key is unlocked and the backend names two collections
    When the key screen is opened
    And I type a holder's key and choose cairn
    And I press Issue
    And I tap Confirm issue twice in the same tick
    Then issueLicence was called once

  Scenario: AC15: a failed read of the issued licences says so plainly, and Retry reads again and shows the list
    Given my key is unlocked and the backend names two collections
    And reading the issued licences fails
    When the key screen is opened
    Then the issued licences section says they could not be read, with a Retry button
    And the technical cause is in a smaller second line
    When the read works and I press Retry
    Then the issued licences are listed
    And the failure message is gone

  Scenario: AC16: a balance below the cost says how short it is, shows my address with Copy, and offers no Confirm issue
    Given my key is unlocked and the backend names two collections
    And my balance is below the cost of a licence
    When the key screen is opened
    And I type a holder's key and choose cairn
    Then the screen says not enough sats, naming what is needed and what I have
    And my own address is shown with a Copy control
    And the Issue button is disabled and there is no Confirm issue

  Scenario: AC17: with enough balance there is no not-enough-sats message
    Given my key is unlocked and the backend names two collections
    When the key screen is opened
    And I type a holder's key and choose cairn
    Then there is no not-enough-sats message
    And I can press Issue and reach Confirm issue

  Scenario: AC18: a failed revoke shows its reason inside the row it belongs to, and the row keeps Confirm revoke
    Given my key is unlocked and the backend names two collections
    And I issued a held licence and a revoked one
    And the broadcast of a revoke fails
    When the key screen is opened
    And I press Revoke on the held licence
    And I confirm the revoke
    Then the held row shows the reason as an alert and keeps Confirm revoke under it
    And the Issued licences section shows no alert outside the row
