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

  Scenario: AC-5: a capitalised, newline-trailed, double-spaced phrase still unlocks a phrase-wrapped key
    Given a phrase-wrapped vault exists from a previously generated key
    When the recovery phrase is typed with a capital first letter, a trailing newline and a double space and used to unlock
    Then the key is unlocked

  Scenario: AC-6: an unknown word in the recovery phrase is named in the error
    Given the key screen is opened
    When a phrase containing the word "Aple" is submitted to restore
    Then the error names "Aple" as not a word of the recovery list

  Scenario: AC-7: the locked screen names the recovery-phrase unlock mode
    Given a phrase-wrapped vault exists from a previously generated key
    When the key screen is reopened
    Then the locked screen says the key is wrapped by the recovery phrase

  Scenario: AC-8: the generated words are shown on one line and the Copy button copies exactly the twelve words
    Given the key screen is opened
    And a new key has been generated
    When "Copy the twelve words" is tapped
    Then the twelve words are shown on a single line with no line breaks
    And the clipboard holds exactly the twelve space-joined words

  Scenario: AC-9: a phrase pasted one word per line unlocks a phrase-wrapped key
    Given a phrase-wrapped vault exists from a previously generated key
    When the recovery phrase is typed one word per line and used to unlock
    Then the key is unlocked
