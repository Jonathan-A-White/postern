Feature: The live loop asks the backend for the messages gently (mw-k3slte)

  Scenario: AC-1: a backend that answers is asked for the messages once a poll interval
    Given the backend has no event stream and answers every call
    When the app has been open for 5 minutes
    Then the messages were asked for at most once every 20 seconds

  Scenario: AC-2: a page nobody is looking at asks for nothing
    Given the backend has no event stream and answers every call
    And the page is hidden
    When the app has been open for 5 minutes
    Then the messages were asked for no more than at the start

  Scenario: AC-3: a stream that opens and closes at once is reconnected with a back-off
    Given the backend has an event stream that opens and closes at once
    When the app has been open for 5 minutes
    Then the stream was opened at most 16 times
    And the messages were asked for at most 17 times
