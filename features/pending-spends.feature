Feature: Not double-spending our own unconfirmed send (mw-1589l.28)

  Scenario: AC3: two messages sent within a minute both broadcast without a mempool conflict
    Given the backend has one spendable coin and a stale unspent list that never drops it
    When two messages are sent one after another
    Then both broadcasts succeed with different transaction ids
    And the second transaction does not spend the coin the first transaction already spent
