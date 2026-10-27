Feature: A message too long for one record goes as several and reads as one (mw-fjpe9tx)

  His phone's outbox read "Retrying in 24 s: Record payload is 21820 bytes, over the 10240-byte cap", every minute, for ever:
  the record was refused on the phone before any request. A long message now goes as several records, none cut.

  Scenario: mw-fjpe9tx AC2: a message of 16,000 bytes goes as several records, each within the cap, his words whole
    Given the backend answers every post
    When he sends a message of 16000 bytes to the thread "week"
    And the sender is woken
    Then the backend took more than 1 record
    And no record's payload was over 10240 bytes
    And the records joined are his words
    And the outbox row is sent

  Scenario: mw-fjpe9tx AC3: a row 0.8.57 queued over the cap goes on its next try
    Given the backend answers every post
    And his outbox holds a message of 16000 bytes that read "Record payload is 21820 bytes, over the 10240-byte cap"
    When the sender is woken
    Then no try threw "over the 10240-byte cap"
    And the records joined are his words
    And the outbox row is sent

  Scenario: mw-fjpe9tx AC4: the thread shows the message in parts as one message, its words whole
    Given the backend answers every post
    When he sends a message of 16000 bytes to the thread "week"
    And the sender is woken
    Then the thread "week" shows 1 message
    And that message's text is his words

  Scenario: mw-fjpe9tx sweep: a To do edit too long for one record is refused on the phone in plain words, not tried every minute
    Given the backend answers every post
    When he saves notes of 16000 bytes on the To do card "mw-t1"
    And the sender is woken
    Then the outbox row is failed with "Too long to send"
    And no record's payload was over 10240 bytes
    And the backend took 0 records
