Feature: Inbox rows are tappable and open their thread (mw-tfne4.31)

  Scenario: AC-3: tapping an inbox message opens its thread where he can reply
    Given a message with a bead thread is in the inbox
    And the backend has spendable coins and accepts the broadcast
    When the inbox is opened, unlocked, the message is tapped, and a reply is typed and sent
    Then the message is shown in its thread
    And the broadcast message decrypts to a reply naming the same bead thread
