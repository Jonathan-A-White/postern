Feature: The key vault

  Scenario: AC-1: generating a new key shows the recovery phrase once
    Given the key screen is opened
    When "Generate a new key" is chosen
    Then a 12-word recovery phrase is shown
    And a button to confirm the phrase has been written down is shown

  Scenario: AC-2: a fingerprint-capable phone wraps the key with the passkey
    Given a platform passkey with fingerprint unlock is available
    And the key screen is opened
    When a new key is generated and the phrase is confirmed
    Then the key is unlocked
    And the wrapped key is stored for unlock by fingerprint

  Scenario: AC-3: a phone without a fingerprint passkey falls back to the phrase
    Given no platform passkey is available
    And the key screen is opened
    When a new key is generated and the phrase is confirmed
    Then the key is unlocked
    And the wrapped key is stored for unlock by the recovery phrase

  Scenario: AC-4: the key restores on a new phone from the recovery phrase
    Given a fresh phone with no stored key
    When the recovery phrase from a previously generated key is entered to restore it
    Then the restored key matches the original key
