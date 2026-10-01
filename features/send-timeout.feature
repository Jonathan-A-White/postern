Feature: A send never spins for ever; what cannot go yet waits on the phone and goes later (mw-t64a3.7, mw-jrx0s.10)

  Scenario: AC-1: a POST that never answers does not hold the composer; the message stays pending and is tried again
    Given the backend takes the challenge but never answers the message
    And he has typed "Is the deploy done?"
    When he taps Send
    Then the composer is free again without any time passing
    And the box is empty
    When 30 seconds pass
    Then the message "Is the deploy done?" is still in the outbox, pending, after a failed try
    And he is told nothing

  Scenario: mw-t64a3.14: a send whose fetch is aborted at the timeout is tried again, and the abort text is never shown
    Given the backend takes the challenge and the browser aborts the message request at the timeout
    And he has typed "Is the deploy done?"
    When he taps Send
    And 30 seconds pass
    Then the message "Is the deploy done?" is still in the outbox, pending, after a failed try
    And he is never shown "signal is aborted without reason"

  Scenario: AC-2: a challenge that never answers leaves the message pending
    Given the backend never answers the challenge
    And he has typed "Is the deploy done?"
    When he taps Send
    And 30 seconds pass
    Then the message "Is the deploy done?" is still in the outbox, pending, after a failed try
    And he is told nothing
    And nothing was posted to the backend

  Scenario: AC-3: a local cache write that never settles does not hold the spinner
    Given the backend takes the message and answers 200
    And the local message store never finishes a write
    And he has typed "Is the deploy done?"
    When he taps Send
    Then Send is ready again without any time passing
    And the box is empty

  Scenario: AC-4: the happy path clears the text
    Given the backend takes the message and answers 200
    And he has typed "Is the deploy done?"
    When he taps Send
    Then Send is ready again without any time passing
    And the box is empty
    And one message was posted to the backend
