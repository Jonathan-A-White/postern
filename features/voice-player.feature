Feature: A voice note's player
  A voice note in a thread can be paused once it is playing, and resumed.

  Scenario: mw-f758y.26: a voice note that is playing can be paused, and the control offers play again
    Given a voice note in a thread
    When he taps play
    Then the voice note is playing and the control offers pause
    When he taps pause
    Then the voice note is paused and the control offers play
