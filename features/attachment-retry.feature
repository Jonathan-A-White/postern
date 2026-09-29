Feature: An attachment that failed to load can be loaded again (mw-t64a3.16)

  Scenario: AC-1: a timed-out image says it could not load and Retry shows it
    Given an image attachment whose first load times out
    When the conversation is shown
    Then it says "Could not load this file" with a Retry control
    When he taps Retry
    Then the image is shown

  Scenario: AC-2: a stream reconnect after a failed load retries once and the image shows
    Given an image attachment whose first load times out
    And the conversation is shown
    When the live stream reconnects
    Then the image is shown
    And the file was fetched twice

  Scenario: AC-2: returning to the foreground after a failed load retries once and the image shows
    Given an image attachment whose first load times out
    And the conversation is shown
    When the app returns to the foreground
    Then the image is shown
    And the file was fetched twice
