Feature: One fingerprint unlock shared across screens

  Scenario: AC1: unlocking on one screen needs no second prompt on another screen
    Given a PRF-wrapped vault exists
    And the key screen is opened and unlocked with a fingerprint
    When the compose screen is opened
    Then the compose screen shows no fingerprint prompt
    When the inbox is opened
    Then the inbox shows no fingerprint prompt
    When the projects screen is opened
    Then the projects screen shows no fingerprint prompt

  Scenario: AC3/AC4: Lock ends the shared session so the next screen prompts again
    Given a PRF-wrapped vault exists
    And the key screen is opened and unlocked with a fingerprint
    When "Lock" is tapped on the key screen
    Then the key screen shows the locked screen
    When the compose screen is opened
    Then the compose screen offers to unlock with your fingerprint
