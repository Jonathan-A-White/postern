Feature: A brief stream drop reads as reconnecting, not offline (mw-t64a3.11)

  Scenario: AC-1: one stream error then a good reconnect never shows offline
    Given the factory is connected and the event stream is live
    When the event stream drops once
    Then the connection reads "reconnecting"
    When the backoff passes and the stream reconnects
    Then the connection reads "live"
    And the connection never read "offline"

  Scenario: AC-2: a stream error, a failed reconnect and a failed sync read offline
    Given the factory is connected and the event stream is live
    And the backend stops answering after the stream drops
    When the event stream drops once
    And the backoff passes and the reconnect fails
    Then the connection reads "offline"

  Scenario: AC-3: the badge says Reconnecting where it said Offline
    Given the factory is connected and the event stream is live
    When the event stream drops once
    Then the badge shows "Reconnecting…"
