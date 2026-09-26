Feature: Composing and sending an encrypted message

  Scenario: AC-1: a text is encrypted so only the recipient key decrypts it
    Given a message is encrypted for the Mayor's public key
    Then the Mayor's private key decrypts it to the original text
    And a different private key fails to decrypt it

  Scenario: AC-2: the class tag is readable without the key
    Given a message of class "alarm" is encrypted for the Mayor's public key
    Then the class tag "alarm" is readable from the payload without decrypting it

  Scenario: AC-3: a successful send shows the txid
    Given the compose screen is opened with an unlocked key and a recipient set
    And the backend has spendable coins and accepts the broadcast
    When a message is typed and sent
    Then the compose screen shows the transaction id

  Scenario: AC-4: an API error is shown and nothing is marked sent
    Given the compose screen is opened with an unlocked key and a recipient set
    And the backend refuses to broadcast the transaction
    When a message is typed and sent
    Then the compose screen shows the backend's error
    And the compose screen does not show a transaction id

  Scenario: mw-f758y.22.2 AC1: sending signs a fresh challenge on every call
    Given the compose screen is opened with an unlocked key and a recipient set
    And the backend has spendable coins and accepts the broadcast
    When a message is typed and sent
    Then the utxos and broadcast calls both carried a valid signed proof of this phone's key

  Scenario: mw-f758y.22.2 AC2: a 401 while sending shows "Licence required"
    Given the compose screen is opened with an unlocked key and a recipient set
    And the backend answers every proved call with 401
    When a message is typed and sent
    Then the compose screen shows "Licence required"

  Scenario: mw-f758y.22.2 AC3: a 401 while syncing shows "Licence required" instead of a fetch error
    Given the backend answers every messages call with 401
    When the inbox is opened
    Then the inbox shows "Offline — showing stored messages (Licence required)"

  Scenario: AC-5: a record addressed to him is shown decrypted
    Given the backend has one message record addressed to him
    When the inbox is opened and unlocked
    Then the message is shown decrypted in the inbox

  Scenario: AC-6: a record addressed to someone else is not shown
    Given the backend has one message record addressed to someone else
    When the inbox is opened and unlocked
    Then no message is shown in the inbox

  Scenario: AC-7: the cursor advances so a second sync fetches nothing new
    Given the backend has one message record addressed to him
    And the inbox has already synced once
    When the inbox is opened again
    Then the second sync asks the backend for records since the first sync's cursor
    And the message is still shown only once

  Scenario: AC-8: offline shows the stored messages
    Given the inbox has already synced and decrypted one message
    When the inbox is opened while the backend is unreachable
    Then the previously stored message is still shown in the inbox

  Scenario: AC-9: a record that fails to decrypt is shown as unreadable, not dropped
    Given the backend has one message record addressed to him that his key cannot decrypt
    When the inbox is opened and unlocked
    Then the message is shown as unreadable in the inbox

  Scenario: mw-tfne4.26: a slow decrypt tail from a previous inbox does not corrupt the next one's message
    Given an inbox was unlocked with one message and its decrypt tail is still resolving
    And a new scenario clears the tables and unlocks a second inbox with its own message
    When the second inbox's decrypt tail is given a chance to catch up
    Then the second message is shown decrypted, not marked unreadable

  Scenario: mw-tfne4.15 AC1: the Mayor's public key wraps instead of overflowing the screen
    Given the compose screen is opened with an unlocked key and a recipient set
    Then the Mayor's public key is rendered in an element that wraps long text

  Scenario: mw-tfne4.18 AC2: a dismissed fingerprint prompt on the inbox screen says "Unlock cancelled"
    Given the inbox is opened with a PRF-wrapped vault and the fingerprint prompt will be dismissed
    When "Unlock with your fingerprint" is tapped
    Then the error says "Unlock cancelled. Tap Unlock to try again."
    And the raw browser sentence and the w3.org link never appear
    And "Unlock with your fingerprint" is still offered

  Scenario: mw-1589l.27 AC2: a message he sent is shown with his own words, not "Sent message."
    Given the backend has one message record he sent to the Mayor
    When the inbox is opened and unlocked
    Then the sent message is shown with his words in the inbox

  Scenario: mw-1589l.27 AC3: a sent row stored before this change is decrypted on the next sync
    Given a sent message row was already stored without plaintext
    When the inbox is opened and unlocked
    Then the sent message is shown with his words in the inbox

  Scenario: mw-1589l.27 AC3: a sent record his key cannot read as sender still shows "Sent message."
    Given the backend has one sent message record his key cannot read as sender
    When the inbox is opened and unlocked
    Then the message is shown as "Sent message." in the inbox

  Scenario: mw-tfne4.18 AC2: a dismissed fingerprint prompt on the send screen says "Unlock cancelled"
    Given the compose screen is opened with a PRF-wrapped vault and the fingerprint prompt will be dismissed
    When "Unlock with your fingerprint" is tapped
    Then the error says "Unlock cancelled. Tap Unlock to try again."
    And the raw browser sentence and the w3.org link never appear
    And "Unlock with your fingerprint" is still offered

  Scenario: mw-f758y.21.1 AC1: a message naming a bead thread is stored under that thread
    Given the backend has one message record addressed to him naming a bead thread
    When the inbox is opened and unlocked
    Then the stored message's thread is "bead:mw-xyz12.3"

  Scenario: mw-f758y.21.1 AC2: a decision-needed message is stored under its own bead as its thread
    Given the backend has one decision-needed message record addressed to him
    When the inbox is opened and unlocked
    Then the stored message's thread is "bead:mw-xyz12.3"

  Scenario: mw-f758y.21.1 AC3: a message with no thread is stored under the general thread
    Given the backend has one message record addressed to him with no thread
    When the inbox is opened and unlocked
    Then the stored message's thread is the general thread
