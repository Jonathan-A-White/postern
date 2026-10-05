Feature: The line does not say Live while the link to the backend is dead (mw-gq6.271)

  Scenario: mw-gq6.271 AC-1: a stream that goes silent without an error stops reading Live
    Given the factory is connected over a link that answers and pings
    When the link dies without a word and the pings stop
    And 90 seconds pass
    Then the connection does not read "live"
    And the badge shows "Reconnecting…"

  Scenario: mw-gq6.271 AC-2: a stream that keeps pinging stays Live
    Given the factory is connected over a link that answers and pings
    When 5 minutes pass
    Then the connection reads "live"

  Scenario: mw-gq6.271 AC-3: a send that gets no answer queues, the line stops reading Live, and the send goes when the backend answers
    Given the factory is connected over a link that answers and pings
    When the link dies without a word and the pings stop
    And he sends "Is the deploy done?"
    And 30 seconds pass
    Then the connection does not read "live"
    And the message "Is the deploy done?" is queued and not sent
    And the status line says "Sending when back online"
    When the link comes back
    And 2 minutes pass
    Then the message "Is the deploy done?" is sent
    And the connection reads "live"
    And the status line says nothing
