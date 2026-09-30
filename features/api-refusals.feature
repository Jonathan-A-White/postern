Feature: What a refused /api call says
  A licensed key is never told it needs a licence. Only a backend that says
  "no licence held" produces "Licence required"; a nonce refusal is retried once
  with a fresh challenge; a failed challenge says the backend could not be reached.

  Scenario: mw-t64a3.25 AC1: a nonce refusal is retried once with a fresh challenge
    Given a backend that refuses the first signed call's nonce
    When a signed call is made with his key
    Then the call succeeds on its second try with a fresh challenge

  Scenario: mw-t64a3.25 AC2: a 401 that says no licence is held is "Licence required"
    Given a backend that says no licence is held
    When a signed call is made with his key
    Then the call fails with "Licence required"

  Scenario: mw-t64a3.25 AC2: two nonce refusals in a row do not blame the licence
    Given a backend that refuses every nonce
    When a signed call is made with his key
    Then the call fails with a message that does not mention a licence
    And the call was tried exactly twice

  Scenario: mw-t64a3.25 AC2: a failed challenge does not blame the licence
    Given a backend whose challenge answers 503
    When a signed call is made with his key
    Then the call fails with a message that does not mention a licence
