Feature: Postern keeps what he is typing, on the phone only (mw-gq6.250)

  Scenario: mw-gq6.250: typing saves a draft once he pauses
    Given the "general" composer is open and empty
    When he types "half a thought" and pauses for 500 ms
    Then the draft stored for "general" is "half a thought"

  Scenario: mw-gq6.250: a second keystroke inside the window saves once
    Given the "general" composer is open and empty
    When he types "half" and then "half a thought" within the window and pauses
    Then the draft was written once and holds "half a thought"

  Scenario: mw-gq6.250: the draft comes back when the composer opens again
    Given the "general" composer is open and empty
    When he types "half a thought" and pauses for 500 ms
    And the composer is closed and opened again
    Then the composer holds "half a thought"

  Scenario: mw-gq6.250: leaving inside the window still keeps the words
    Given the "general" composer is open and empty
    When he types "quick words" and the composer is closed at once
    And the composer is opened again
    Then the composer holds "quick words"

  Scenario: mw-gq6.250: Send clears the draft
    Given the "general" composer is open and empty
    When he types "half a thought" and pauses for 500 ms
    And he taps Send
    Then no draft is stored for "general"
    And the composer is empty

  Scenario: mw-gq6.250: an empty composer removes the draft
    Given the "general" composer is open and empty
    When he types "half a thought" and pauses for 500 ms
    And he clears the box and pauses for 500 ms
    Then no draft is stored for "general"

  Scenario: mw-gq6.250: a draft for one channel does not show in another
    Given the "general" composer is open and empty
    When he types "half a thought" and pauses for 500 ms
    And the composer is closed and the "topic:ideas" composer is opened
    Then the composer is empty

  Scenario: mw-gq6.250: a reply has its own draft apart from its channel
    Given the "general" composer is open and empty
    When he types "half a thought" and pauses for 500 ms
    And the composer is closed and a reply composer under "abc123" is opened
    Then the composer is empty

  Scenario: mw-f758y.41 AC-2: two channels keep two unsent texts across a close and reopen
    Given the "topic:one" composer is open and empty
    When he types "first words" and pauses for 500 ms
    And the composer is closed and the "topic:two" composer is opened
    And he then types "second words" and pauses for 500 ms
    And the app is closed and opened again on the "topic:one" channel
    Then the composer holds "first words"
    When the composer is closed and the "topic:two" channel is opened again
    Then the composer then holds "second words"
