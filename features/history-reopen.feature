Feature: Postern keeps his history across a close and reopen (mw-f758y.41)

  Scenario: mw-f758y.41 AC-1: Back walks the last 20 screens after a reopen, newest first, then the Map
    Given he has visited 25 beads one after another
    When the app is closed and opened again at its bare address
    Then the app opens at the newest bead
    And pressing Back 19 times reaches the 20th newest bead
    And one more Back lands on the Map

  Scenario: mw-f758y.41 AC-1: a screen whose bead no longer exists is skipped on the way back
    Given he has visited the beads "mw-a.1", "mw-gone.1" and "mw-b.1"
    And the app is closed and opened again at its bare address
    When he presses Back and the backend says the bead "mw-gone.1" does not exist
    Then the app is at the bead "mw-a.1"

  Scenario: mw-f758y.41 AC-1: a push tap wins over the restored screen, and Back returns to the restored history
    Given he has visited the beads "mw-a.1" and "mw-b.1"
    When the app is opened by a push tap at the thread "topic:library"
    Then the app opens at the thread "topic:library"
    And pressing Back reaches the bead "mw-b.1"
    And pressing Back reaches the bead "mw-a.1"

  Scenario: mw-f758y.41 AC-2: each channel keeps its own scroll position across a reopen
    Given he has scrolled the thread "topic:one" to 300 and the thread "topic:two" to 120
    When the app is closed and opened again at its bare address
    Then the thread "topic:two" is scrolled to 120
    And going Back to the thread "topic:one" scrolls it to 300
