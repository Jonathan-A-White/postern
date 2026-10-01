Feature: The factory's events are never a message or a bubble (mw-jrx0s.22)

  Scenario: mw-jrx0s.22 AC-1: an events record that comes by the backend feed is projected and makes no message
    Given the phone holds one real message and the events cursor is at 0
    When the backend feed, which the stream's message event pulls, brings an events record
    Then the event is projected
    And Factory and the bead channel show only the real message

  Scenario: mw-jrx0s.22 AC-2: an events record read from the chain is projected and makes no message
    Given the phone holds one real message and the events cursor is at 0
    When an events transaction is on the anchor address and the phone reads the chain
    Then the event is projected
    And Factory and the bead channel show only the real message

  Scenario: mw-jrx0s.22 AC-3: a message row stored from an events record is removed when the app opens
    Given the phone holds one real message and a row an older build stored from an events record
    When the app opens
    Then the stored events row is gone
    And Factory and the bead channel show only the real message
