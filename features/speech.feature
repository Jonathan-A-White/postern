Feature: Play — reading a message or question aloud

  Scenario: AC-1: Play on a message speaks its text once
    Given the phone supports speech synthesis
    And the inbox has one decrypted message
    When Play is tapped on the message
    Then speech is spoken once with the message's text

  Scenario: AC-2: Play on a question speaks the question, the recommendation and the options
    Given the phone supports speech synthesis
    And the Question screen is showing a question
    When Play is tapped
    Then speech is spoken once with the question, "Recommended: ship" and the options

  Scenario: AC-3: a second tap stops the speech
    Given the phone supports speech synthesis
    And the inbox has one decrypted message
    And Play has been tapped on the message
    When Play is tapped again
    Then the speech is cancelled

  Scenario: AC-4: leaving the screen stops the speech
    Given the phone supports speech synthesis
    And the inbox has one decrypted message
    And Play has been tapped on the message
    When the screen is left
    Then the speech is cancelled

  Scenario: AC-5: no speech synthesis hides the control
    Given the phone has no speech synthesis
    And the inbox has one decrypted message
    Then no Play control is shown
