Feature: Not double-spending our own unconfirmed send (mw-1589l.28)

  Scenario: AC3: two messages sent within a minute both broadcast without a mempool conflict
    Given the backend has one spendable coin and a stale unspent list that never drops it
    When two messages are sent one after another
    Then both broadcasts succeed with different transaction ids
    And the second transaction does not spend the coin the first transaction already spent

  Scenario: mw-tfne4.33: a third message in a chain of unconfirmed sends never respends an earlier one's change
    Given the backend has one spendable coin and a stale unspent list that never catches up on a whole chain
    When three messages are sent one after another
    Then all three broadcasts succeed with different transaction ids
    And no later transaction spends an outpoint an earlier transaction already spent
    And no transaction names the same outpoint twice among its inputs
