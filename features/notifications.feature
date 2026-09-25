Feature: Per-class notification settings

  Scenario: AC-1: the settings screen preloads the decided defaults for every class
    Given the notification settings screen is opened for the first time
    Then "decision-needed" shows sound on, vibrate on, stay until dismissed on, and quiet off
    And "landing" shows sound on, vibrate off, stay until dismissed off, and quiet off
    And "alarm" shows sound on, vibrate on, stay until dismissed on, and quiet off
    And "message" shows sound on, vibrate on, stay until dismissed off, and quiet off

  Scenario: AC-2: a changed setting changes that class's notifications only
    Given the notification settings screen is opened
    When vibrate is turned off for "message"
    Then a pushed record of class "message" has no vibrate pattern
    And a pushed record of class "alarm" still has its vibrate pattern

  Scenario: AC-3: reset to defaults restores every class's decided settings
    Given the notification settings screen is opened
    And vibrate is turned off for "message"
    When "Reset to defaults" is tapped
    Then "message" shows sound on, vibrate on, stay until dismissed off, and quiet off
    And a pushed record of class "message" has its vibrate pattern back
