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
