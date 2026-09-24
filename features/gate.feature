Feature: The gate

  Scenario: AC-1: a visitor sees the locked gate
    Given the app is opened
    Then the screen shows "The gate is locked"
    And the app name "Postern" and the version from package.json

  Scenario: AC-2: no key offers a link to set one up
    Given no key has been set up
    When the app is opened
    Then the screen shows "The gate is locked"
    And a "Set up your key" link to the key screen is offered

  Scenario: AC-3: a key without a licence shows the address and no licence found
    Given a key exists with no licence on chain
    When the app is opened
    Then the screen shows the key's testnet address
    And the screen shows "No licence found"
    And a "Check again" action is offered

  Scenario: AC-4: a key with a licence opens the gate
    Given a key exists holding a licence on chain
    When the app is opened
    Then the screen shows "Licensed"
    And the screen shows the key's testnet address

  Scenario: AC-5: a cached licensed answer opens the gate offline
    Given a key exists holding a licence on chain
    And the gate has already opened once and cached that answer
    When the chain goes offline
    And the app is opened again
    Then the screen shows "Licensed"
