Feature: A call to the backend never hangs its caller, and concurrent calls never share a nonce (mw-gq6.276)

  Scenario: mw-gq6.276 AC-2: a messages fetch whose body stops coming gives up, and the next good fetch advances the cursor
    Given the messages cursor stands at 15678
    When a messages fetch is answered 200 and its body stops halfway
    And 31 seconds pass with no more of it
    Then that sync has given up with "The backend did not answer in time."
    And the messages cursor still stands at 15678
    When the next messages fetch is answered whole, naming next 16433
    Then the messages cursor stands at 16433
    And the fetch asked for since=15678

  Scenario: mw-gq6.276 AC-3: concurrent calls each sign a nonce of their own and none is refused
    Given a backend whose nonces are single-use
    When 8 calls go to it at once
    Then every call is answered 200
    And each call was signed with its own nonce, one the backend issued
