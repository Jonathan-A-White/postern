Feature: A pause while he holds the Talk line rings no bell (mw-q6n8m0.16, from voice-kit's mw-q6n8m0.18)

  Android plays its start tone every time a speech recogniser is started, so a recogniser started again
  after a pause rang a bell in the middle of his hold. On a phone that can record, the recogniser is
  started once in a hold: when it ends by itself on a pause, the rest of the hold is recorded from the
  microphone instead, and its words follow on release.

  Scenario: mw-q6n8m0.16 AC-1: a pause that ends the recogniser mid-hold does not start it again; the rest of the hold is recorded, and the words before the pause go as the turn
    Given the phone's microphone is voice-kit's honest one, hearing "Please read me the first chapter"
    And the Talk line is open
    When he presses and holds the talk button until the recogniser has heard the whole clip
    Then the live transcript reads "Please read me the first chapter"
    When he pauses for 5 seconds and the recogniser ends by itself
    Then the recogniser has been started once in the hold, so no start tone rang mid-hold
    And the rest of the hold is being recorded from the microphone
    And the talk button reads "Release to send"
    When he speaks on for 3 seconds and lets go of the talk button
    Then one turn is sent, starting with "Please read me the first chapter"
    And the recording of the rest has stopped
    And the recogniser was still started only once
