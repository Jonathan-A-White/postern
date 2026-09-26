Feature: Threads: list, open, reply and new topic (mw-f758y.21.3)

  Scenario: AC-1: threads are listed by newest activity, a bead thread titled from the snapshot, topics by name, the general thread last, each with its unread count
    Given a bead thread, a topic thread and the general thread each have one unread message, the topic the newest, then the general thread, then the bead thread the oldest
    And the snapshot names the bead thread's title
    When the Threads screen is opened and unlocked
    Then the threads are listed in the order: the topic thread, the bead thread titled from the snapshot, then the general thread last
    And each thread's row shows "1 unread"

  Scenario: AC-2: opening a thread shows its messages in order
    Given a bead thread has two messages sent out of chronological order
    When the Threads screen is opened, unlocked and that thread's row is opened
    Then the thread's messages are shown oldest first

  Scenario: AC-3: a reply sent from an open thread carries the same thread
    Given a bead thread already has one message
    And the Threads screen is opened, unlocked and that thread's row is opened
    And the backend has spendable coins and accepts the broadcast
    When a reply is typed and sent
    Then the broadcast message decrypts to a reply naming the same bead thread

  Scenario: AC-4: a New topic control opens a named thread
    Given the Threads screen is opened and unlocked
    When "New topic" is used to open a topic named "launch plan"
    Then the thread screen for "launch plan" is shown, with no messages yet and a reply box
