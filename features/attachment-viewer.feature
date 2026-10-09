Feature: A tapped attachment opens: a picture full screen, a file in a new tab or downloaded (mw-jtzpw0.5)

  Scenario: AC-1: tapping a picture in the composer opens it full screen
    Given the composer is open with the picture "shot.png" attached
    When he taps the picture "shot.png"
    Then a full-screen viewer shows the picture "shot.png"

  Scenario: AC-1: the close button returns to the composer with the picture still attached
    Given the composer is open with the picture "shot.png" attached
    When he taps the picture "shot.png"
    And he taps Close picture
    Then the viewer is gone
    And the picture "shot.png" is still attached

  Scenario: AC-1: Back returns to the composer with the picture still attached
    Given the composer is open with the picture "shot.png" attached
    When he taps the picture "shot.png"
    And he presses Back
    Then the viewer is gone
    And the picture "shot.png" is still attached

  Scenario: AC-1: the x still removes the picture and opens nothing
    Given the composer is open with the picture "shot.png" attached
    When he taps the x on "shot.png"
    Then the viewer is gone
    And nothing is waiting to be sent

  Scenario: AC-2: tapping a picture in a sent message opens it full screen
    Given a sent message with the picture "wall.png"
    When the conversation is shown
    And he taps the picture in the message
    Then a full-screen viewer shows the picture "wall.png"

  Scenario: AC-2: a PDF in a sent message opens in a new tab with its name shown
    Given a sent message with a file "plan.pdf" of type "application/pdf" and 4096 bytes
    When the conversation is shown
    Then it shows the file "plan.pdf" with its size "4 KB"
    When he taps the file "plan.pdf"
    Then a new tab is opened

  Scenario: AC-2: a PDF attached in the composer opens in a new tab with its name shown
    Given the composer is open with the file "plan.pdf" of type "application/pdf" attached
    When he taps the file "plan.pdf"
    Then a new tab is opened
    And the file "plan.pdf" is still attached

  Scenario: AC-2: a file the browser cannot show, attached in the composer, is downloaded under its name
    Given the composer is open with the file "data.zip" of type "application/zip" attached
    When he taps the file "data.zip"
    Then the file is downloaded as "data.zip"
    And the file "data.zip" is still attached

  Scenario: AC-1: pinching spreads and squeezes the picture between its size and six times that
    Given a picture shown full screen
    When two fingers spread to 3 times their distance
    Then the picture is 3 times its size
    When two fingers keep spreading to 20 times their distance
    Then the picture stops at 6 times its size
    When two fingers squeeze to a tenth of their distance
    Then the picture is back at its own size

  Scenario: AC-1: a double tap zooms the picture in and the next one back out
    Given a picture shown full screen
    When he double-taps the picture
    Then the picture is zoomed in
    When he double-taps the picture again
    Then the picture is back at its own size
