Feature: A one-tap action waits until the view has passed the event that echoed it, not by the phone's clock (mw-xhtcup.14)

  Scenario: mw-xhtcup.14 AC-1: a slow phone clock does not offer a tapped Release again
    Given the phone's clock is 10 minutes slow
    And he taps Release on a held story against a view of seq 10
    When a view of seq 11 without the echo arrives
    Then the Release button stays gone and the card says it is waiting
    When the echo event of seq 12 is stored and a view of seq 12 with the story released arrives
    Then the card no longer waits and Release is not offered

  Scenario: mw-xhtcup.14 AC-2: a fast phone clock does not hide a view that has seen the tap
    Given the phone's clock is 10 minutes fast
    And he taps Release on a held story against a view of seq 10
    When the echo event of seq 12 is stored and a view of seq 12 arrives that still holds the story
    Then the card no longer says it is waiting
    And Release is offered again

  Scenario: mw-xhtcup.14 AC-3: a view with no seq is judged by its written_at as before
    Given the phone's clock is right
    And he taps Release on a held story against a view with no seq
    Then the card says it is waiting
    When a view with no seq written after the tap arrives
    Then the card no longer says it is waiting
