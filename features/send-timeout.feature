Feature: A send never spins for ever, and he always knows whether it went (mw-t64a3.7)

  Scenario: AC-1: a POST that never answers ends the spinner and says the message may have gone
    Given the backend takes the challenge but never answers the message
    And he has typed "Is the deploy done?"
    When he taps Send
    Then Send is busy
    When 30 seconds pass
    Then Send is ready again
    And he is told "May have gone: check the channel before sending again"
    And the text "Is the deploy done?" is still in the box

  Scenario: mw-t64a3.14: a send whose fetch is aborted at the timeout says it may have gone, never the abort text
    Given the backend takes the challenge and the browser aborts the message request at the timeout
    And he has typed "Is the deploy done?"
    When he taps Send
    And 30 seconds pass
    Then he is told "May have gone: check the channel before sending again"
    And he is never shown "signal is aborted without reason"

  Scenario: AC-2: a challenge that never answers says the message was not sent
    Given the backend never answers the challenge
    And he has typed "Is the deploy done?"
    When he taps Send
    And 30 seconds pass
    Then Send is ready again
    And he is told "Not sent: try again"
    And the text "Is the deploy done?" is still in the box

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
