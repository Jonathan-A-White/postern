Feature: A picture sends with one tap, no typing (mw-jtzpw0.10; the Send arrow comes from bsv-kit's composer 0.2.0, Hold to talk stays the big button)

  Scenario: AC-1: with the bar out and a picture attached, a Send arrow stands beside Hold to talk
    Given the composer is open
    When he attaches the picture "photo.png"
    And he taps the mic
    Then the Hold to talk bar and a Send arrow are both there, the arrow after the bar

  Scenario: AC-2: with the bar out and nothing attached there is no Send arrow
    Given the composer is open
    When he taps the mic
    Then there is no Send arrow

  Scenario: AC-3: one tap on the Send arrow sends the picture with no text
    Given the composer is open
    When he attaches the picture "photo.png"
    And he taps the mic
    And he taps the Send arrow
    Then one message is delivered with one attachment and no text
    And the picture is no longer attached and the Send arrow is gone

  Scenario: AC-4: removing the picture takes the Send arrow away
    Given the composer is open
    When he attaches the picture "photo.png"
    And he taps the mic
    And he removes the picture "photo.png"
    Then there is no Send arrow

  Scenario: AC-5: while the bar is held the Send arrow waits
    Given the composer is open
    When he attaches the picture "photo.png"
    And he taps the mic
    And he presses and holds the bar
    Then the Send arrow is disabled

  Scenario: AC-6: a big photo is cut to 2400 px on its long edge and sent as a JPEG (mw-7dige5.2)
    Given the composer is open
    And the phone reads pictures as 4000 by 3000 pixels
    When he attaches the picture "photo.png"
    And he taps the mic
    And he taps the Send arrow
    Then the picture was drawn at 2400 by 1800 pixels
    And one message is delivered with a JPEG attachment named "photo.jpg"
