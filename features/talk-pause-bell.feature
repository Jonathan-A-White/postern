Feature: A pause while he holds the Talk line keeps listening, and the words after it join the turn (mw-gq6.570, which replaces mw-q6n8m0.16's record-the-rest)

  Android ends the speech recogniser by itself on a pause. voice-kit then records the rest of the hold and plays
  the recording to a fresh recogniser on release; Android's speech service listens to the microphone itself and
  hears nothing in that recording, so the turn went with only the words before the pause and 'The words after the
  pause could not be made out' (his "create a to-do for me", the rest lost). The Talk line now listens on: the
  recogniser is started again, the words before kept, and everything he says while his finger is down is the turn.
  The cost is Android's start tone at the restart, which is better than a lost sentence.

  Scenario: mw-gq6.570 AC-1: a 3 second pause mid-sentence ends the recogniser; it is started again, and the words before and after the pause go as one turn
    Given the phone's microphone is voice-kit's honest one, hearing "create a to-do for me"
    And the Talk line is open
    When he presses and holds the talk button until the recogniser has heard the whole clip
    Then the live transcript reads "create a to-do for me"
    When he pauses for 3 seconds and then says "called buy milk"
    Then the recogniser was started again, so the hold went on listening
    And no recording of the rest of the hold was started
    And the page still has its recorder, because the kit listens through the pause by itself
    And the live transcript reads "create a to-do for me called buy milk"
    And the talk button reads "Release to send"
    And no turn has been sent
    When he lets go of the talk button
    Then one turn is sent with the words "create a to-do for me called buy milk"
    And the screen does not say that words after the pause could not be made out
