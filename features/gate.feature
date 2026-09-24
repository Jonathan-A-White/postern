Feature: The gate

  Scenario: AC-1: a visitor sees the locked gate
    Given the app is opened
    Then the screen shows "The gate is locked"
    And the app name "Postern" and the version from package.json
