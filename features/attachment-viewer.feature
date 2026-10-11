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

  Scenario: AC-2: Save on a picture in his own sent message downloads it under its name, its own bytes and type (mw-jtzpw0.7)
    Given a sent message with the picture "receipt.jpg" of type "image/jpeg"
    When the conversation is shown
    And he opens the picture in the message
    And he taps Save picture
    Then a link downloads "receipt.jpg" from the picture's own bytes of type "image/jpeg"
    And the viewer says the picture was saved

  Scenario: AC-4: Save on a picture in a received message downloads it under its name, its own bytes and type (mw-jtzpw0.7)
    Given a received message with the picture "wall.png" of type "image/png"
    When the conversation is shown
    And he opens the picture in the message
    And he taps Save picture
    Then a link downloads "wall.png" from the picture's own bytes of type "image/png"

  Scenario: AC-2: a picture with no name of its own is saved as postern and the date (mw-jtzpw0.7)
    Given a picture with no name shown full screen on 2026-10-10
    When he taps Save picture
    Then a link downloads "postern-2026-10-10.jpg"

  Scenario: AC-3: a phone that can download does not open the share sheet (mw-jtzpw0.7)
    Given a phone that can download and share
    And a sent message with the picture "receipt.jpg" of type "image/jpeg"
    When the conversation is shown
    And he opens the picture in the message
    And he taps Save picture
    Then a link downloads "receipt.jpg" from the picture's own bytes of type "image/jpeg"
    And the share sheet was not opened

  Scenario: AC-3: a phone that cannot download hands the picture to the share sheet (mw-jtzpw0.7)
    Given a phone that can share but not download
    And a received message with the picture "wall.png" of type "image/png"
    When the conversation is shown
    And he opens the picture in the message
    And he taps Save picture
    Then the share sheet gets "wall.png" with the picture's own bytes of type "image/png"
    And nothing was downloaded
    And the viewer says the picture was shared

  Scenario: AC-3: a phone that can neither download nor share says the picture was not saved (mw-jtzpw0.7)
    Given a phone that can neither download nor share
    And a picture "shot.png" shown full screen
    When he taps Save picture
    Then the viewer says the picture could not be saved
