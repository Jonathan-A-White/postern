Feature: What he taps, answers and says is queued on the phone first, shown pending, and sent in order (mw-jrx0s.10)

  Scenario: mw-jrx0s.10: a tap while offline shows pending at once and is sent when the backend answers
    Given the backend cannot be reached
    And a question card with the options "Yes" and "No"
    When he taps "Yes"
    Then the card is dead and shows the mark "pending"
    And the status line says "Sending when back online"
    And the outbox holds one pending answer
    When the backend answers again
    Then the answer "Yes" has gone to the backend once
    And the card shows no pending mark and says "Answered: Yes"
    And the status line says nothing

  Scenario: mw-jrx0s.10: two taps go out in order
    Given the backend cannot be reached
    When he taps "Release" on bead "mw-a" and then "Hold" on bead "mw-b"
    And the backend answers again
    Then the backend heard "release mw-a" first and "hold mw-b" second

  Scenario: mw-jrx0s.10: a failed send is tried again and keeps its place in the order
    Given the backend refuses the first try
    When he taps "Release" on bead "mw-a" and then "Hold" on bead "mw-b"
    And the sender is woken
    Then the backend heard "release mw-a" first and "hold mw-b" second

  Scenario: mw-jrx0s.10: a reload keeps the pending tap and sends it
    Given the backend cannot be reached
    And a question card with the options "Yes" and "No"
    When he taps "Yes"
    And the app is reloaded
    And the backend answers again
    And the app opens
    Then the answer "Yes" has gone to the backend once

  Scenario: mw-jrx0s.10: a message typed offline shows pending in its thread and is sent when back online
    Given the backend cannot be reached
    And the Talk channel "ops" is open
    When he sends "Ship it" from the composer
    Then the composer is empty
    And the thread shows "Ship it" with the mark "pending"
    When the backend answers again
    Then the message "Ship it" has gone to the backend once

  Scenario: mw-jrx0s.10: a sent message is acked when its record arrives by since-paging
    Given a sent message whose record the phone has not seen yet
    And the thread shows "Held on" with the mark "pending"
    When the record arrives by since-paging
    Then the outbox row is acked
    And the thread shows "Held on" with no pending mark

  Scenario: mw-jrx0s.10: a sent answer is acked when its card_answered event arrives
    Given a sent action whose event the phone has not heard yet
    When the card_answered event arrives with the same txid
    Then the outbox row is acked

  Scenario: mw-jrx0s.10: a Talk turn is queued and shown pending
    Given the backend cannot be reached
    When a Talk turn "Hello" is sent
    Then the outbox holds one pending turn
    When the backend answers again
    Then the turn "Hello" has gone to the backend once

  Scenario: mw-jrx0s.10: the app never says it could not send
    Then no file under src says "Could not send. Try again."
