Feature: The chain reader is gentle with WhatsOnChain and loses nothing (mw-jrx0s.20)

  Scenario: mw-jrx0s.20 AC-1: reads back off while WhatsOnChain refuses, and go back to every 5 s once it answers
    Given the phone cannot reach the backend and WhatsOnChain answers 429
    When the phone has been out of reach for 70 seconds
    Then WhatsOnChain was asked for the history 3 times
    When WhatsOnChain answers again with a message on the anchor address and 11 more seconds pass
    Then WhatsOnChain was asked for the history 5 times

  Scenario: mw-jrx0s.20 AC-2: a long unread history is fetched a few transactions per read, the rest on the next
    Given the phone cannot reach the backend and 22 messages are on the anchor address
    When the first chain read has finished
    Then WhatsOnChain was asked for the hex of 10 transactions
    And 10 messages are on the phone
    When two more chain reads have finished
    Then WhatsOnChain was asked for the hex of 22 transactions
    And 22 messages are on the phone

  Scenario: mw-jrx0s.20 AC-3: a transaction whose hex fails loses nothing else, and is asked for again
    Given the phone cannot reach the backend and 3 messages are on the anchor address
    And WhatsOnChain fails to give the hex of the second
    When the first chain read has finished
    Then 2 messages are on the phone
    When WhatsOnChain gives the hex again and the reader's backoff has passed
    Then 3 messages are on the phone

  Scenario: mw-1ox07o.3 AC-1: empty reads back off 5, 10, 20, 40, 60, 60 s while the backend stays out of reach
    Given the phone cannot reach the backend and the anchor address has no messages
    When the phone has been out of reach for 74 seconds
    Then WhatsOnChain was asked for the history 3 times
    When 2 more seconds pass
    Then WhatsOnChain was asked for the history 4 times
    When 120 more seconds pass
    Then WhatsOnChain was asked for the history 6 times
    When 58 more seconds pass
    Then WhatsOnChain had still been asked for the history 6 times
    When 3 more seconds pass
    Then WhatsOnChain was asked for the history 7 times

  Scenario: mw-1ox07o.3 AC-2: a message found on the chain brings the wait back to 5 s
    Given the phone cannot reach the backend and the anchor address has no messages
    When the phone has been out of reach for 16 seconds
    Then WhatsOnChain was asked for the history 2 times
    When a message lands on the anchor address and 20 more seconds pass
    Then WhatsOnChain was asked for the history 3 times
    And 1 message is on the phone
    When 6 more seconds pass
    Then WhatsOnChain was asked for the history 4 times

  Scenario: mw-1ox07o.3 AC-3: a hidden page makes no chain read, and reads again once it is visible
    Given the phone cannot reach the backend and the page is hidden
    When the phone has been out of reach for 200 seconds
    Then WhatsOnChain was not asked for the history
    When the page becomes visible and 6 seconds pass
    Then WhatsOnChain was asked for the history 1 time
