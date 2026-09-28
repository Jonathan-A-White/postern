Feature: Messages: the envelope, direct delivery and sync (docs/protocol.md §1, §2, §6, §9)

  Scenario: AC-1: a text is encrypted so only the recipient key decrypts it
    Given a message "ship it" encrypted from his key to the Mayor
    Then the Mayor's key decrypts it to "ship it"
    And another key cannot decrypt it

  Scenario: AC-2: the class tag is readable without the key
    Given a "decision-needed" message encrypted from his key to the Mayor
    Then its class reads "decision-needed" without any key

  Scenario: plans/0021 AC-D1: a message is delivered directly as its record script, from his own key
    Given a backend that takes direct delivery
    When he sends "morning" to the Mayor
    Then one POST to /api/messages carries a record script whose payload is from his key to the Mayor
    And no transaction is built or broadcast

  Scenario: plans/0021 AC-D2: an old backend without direct delivery gets a funded transaction instead
    Given a backend that answers 404 to POST /api/messages but has coins for him
    When he sends "morning" to the Mayor
    Then the message is broadcast as a transaction

  Scenario: plans/0021 AC-D3: what he sends is in its thread at once, before any sync
    Given a backend that takes direct delivery
    When he sends "about the stream" in the thread of bead "mw-f758y.30.2"
    Then a sent row with his own words is stored under thread "bead:mw-f758y.30.2"

  Scenario: mw-f758y.22.2 AC1: every call signs a fresh challenge
    Given a backend that takes direct delivery
    When he sends "one" and then "two" to the Mayor
    Then each POST carried its own freshly signed challenge

  Scenario: AC-5: a record addressed to him is stored decrypted
    Given the backend holds a message from the Mayor to him saying "hello"
    When the messages are synced with his key unlocked
    Then a received row reads "hello"

  Scenario: AC-6: a record addressed to someone else is not stored
    Given the backend holds a message from the Mayor to someone else
    When the messages are synced with his key unlocked
    Then no row is stored

  Scenario: AC-7: the cursor advances so a second sync fetches nothing new
    Given the backend holds a message from the Mayor to him saying "hello"
    When the messages are synced with his key unlocked
    And the messages are synced again
    Then the second sync asked only for records after the first one's head

  Scenario: AC-9: a record that fails to decrypt is kept, marked unreadable
    Given the backend holds a message addressed to him that his key cannot decrypt
    When the messages are synced with his key unlocked
    Then the row is kept and marked as failing to decrypt

  Scenario: mw-1589l.27 AC2: a message he sent is stored with his own words
    Given the backend holds a message he sent to the Mayor saying "on my way"
    When the messages are synced with his key unlocked
    Then a sent row reads "on my way"

  Scenario: mw-f758y.21.1 AC1: a message naming a bead thread is stored under that thread
    Given the backend holds a message from the Mayor in the thread of bead "mw-xyz.3"
    When the messages are synced with his key unlocked
    Then the row is stored under thread "bead:mw-xyz.3"

  Scenario: mw-f758y.21.1 AC2: a decision-needed message is stored under its own bead as its thread
    Given the backend holds a question from the Mayor about bead "mw-xyz.4"
    When the messages are synced with his key unlocked
    Then the row is stored under thread "bead:mw-xyz.4"

  Scenario: mw-f758y.22.2 AC3: a 401 while syncing is "Licence required"
    Given a backend that answers 401 to every call
    When the messages are synced with his key unlocked
    Then the sync fails with "Licence required"
