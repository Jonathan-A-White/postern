Feature: Read aloud only where the phone can speak, stopping when the screen is left, and what a need says (mw-xhtcup.13)

  Scenario: mw-xhtcup.13 AC1: a phone with no speech synthesis shows no Read-aloud control
    Given the phone has no speech synthesis
    When a Needs card is shown
    Then no Read-aloud control is shown

  Scenario: mw-xhtcup.13 AC2: leaving the screen stops the speech
    Given the phone supports speech synthesis
    And a Needs card is shown and he has tapped "Read aloud"
    When the screen is left
    Then the speech is cancelled once

  Scenario: mw-xhtcup.13 AC3: a question reads as the question, the recommendation, then the options
    Given the phone supports speech synthesis
    And a Needs card asks "Release the held story?" with options "A: Release it" and "B: Hold", recommending "A: Release it"
    When he taps "Read aloud"
    Then the phone says the question, then "The Mayor recommends Release it.", then "A, Release it. B, Hold."
