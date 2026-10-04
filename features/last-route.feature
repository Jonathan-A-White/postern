Feature: Postern reopens where he left it (mw-f758y.31)

  Scenario: mw-f758y.31 AC-1: a bare open goes back to the bead he was on
    Given he has been on the bead "mw-x.1"
    When the app is closed and opened again at its bare address
    Then the app opens at the bead "mw-x.1"

  Scenario: mw-f758y.31 AC-1: a channel thread is kept too
    Given he has been in the thread "topic:library" of Channels
    When the app is closed and opened again at its bare address
    Then the app opens at the thread "topic:library"

  Scenario: mw-f758y.31 AC-1: the last move is the one kept
    Given he has been on the bead "mw-x.1"
    And he then moved to the Me screen
    When the app is closed and opened again at its bare address
    Then the app opens at the Me screen

  Scenario: mw-f758y.31 AC-1: a push tap wins over where he left
    Given he has been on the bead "mw-x.1"
    When the app is opened by a push tap at the thread "topic:library"
    Then the app opens at the thread "topic:library"

  Scenario: mw-f758y.31 AC-1: a push's landing screen is not somewhere to return to
    Given he has been on the bead "mw-x.1"
    And a push tap then showed him an alarm
    When the app is closed and opened again at its bare address
    Then the app opens at the bead "mw-x.1"

  Scenario: mw-f758y.31 AC-1: a first open, with nothing kept, opens as it always did
    Given nothing has been kept
    When the app is closed and opened again at its bare address
    Then the address is still bare

  Scenario: mw-f758y.31 AC-1: a bead that no longer exists falls back to the Map
    Given he has been on the bead "mw-gone.1"
    And the app is opened again at its bare address
    When the backend says there is no such bead
    Then the app moves to the Map

  Scenario: mw-f758y.31 AC-1: a bead typed into a link that does not exist is still told so
    Given he follows a link to the bead "mw-gone.2"
    When the backend says there is no such bead
    Then the screen says "No such bead"

  Scenario: mw-f758y.31 AC-1: the scroll position of the screen comes back too
    Given he has scrolled the bead "mw-x.1" to 300
    When the app is closed and opened again at its bare address
    Then the bead "mw-x.1" is scrolled to 300
