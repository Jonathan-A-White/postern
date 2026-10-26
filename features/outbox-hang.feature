Feature: A send whose first try hangs goes on its own, and the status line tells the truth while the phone is online (mw-gb92lmo)

  Scenario: mw-gb92lmo AC-3: online, a message whose first POST hangs is delivered after the timeout without a reload, and the status line clears
    Given the phone reaches the backend, which takes the challenge but never answers the message, and the chain provider never answers either
    And he has typed "Is the deploy done?"
    When he taps Send
    And 2 minutes pass
    Then the message "Is the deploy done?" is still pending after a failed try
    And the status line never says "Sending when back online"
    When the backend answers the message
    And 2 more minutes pass
    Then the message "Is the deploy done?" is sent once without a reload
    And the status line says nothing
