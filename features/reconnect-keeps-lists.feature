Feature: Nothing the phone holds goes missing while it reconnects (mw-v1uyku.2)

  Scenario: mw-v1uyku.2 AC1: Channels lists every channel with its unread count while the pill says Reconnecting…
    Given the phone holds posts in Factory, in a bead's channel and in the channel "desktop move", some unread
    And the Channels list is open and the connection is live
    When the connection drops and the phone is slow to read what it holds
    And he leaves Channels and comes back
    Then the pill reads "Reconnecting…"
    And the Channels list shows Factory, the bead's channel with 2 unread and "desktop move" with 1 unread

  Scenario: mw-v1uyku.2 AC2: a channel's messages stay shown while the pill says Reconnecting…
    Given the phone holds posts in Factory, in a bead's channel and in the channel "desktop move", some unread
    And the Channels list is open and the connection is live
    When the connection drops and the phone is slow to read what it holds
    And the channel "desktop move" is opened afresh
    Then the connection still reads reconnecting
    And the channel shows "The runbook is in hosts/desktop-move.md" and not "Nothing said here yet"
