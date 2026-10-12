Feature: The Talk line while Ideas only is on (mw-8ifimx.4)

  The turn goes out unchanged, but the line does not wait for an answer that will not come until the
  mode ends: it says and shows that the turn is recorded for later, and is ready for the next one.

  Scenario: mw-8ifimx.4 AC-3: a turn with the mode on is recorded, spoken, and the line is idle at once
    Given Ideas only is on until 21:00 and the phone's clock says 14:00
    And the Talk line is open with a believable speech recogniser
    When he holds the talk button and says "an idea for the map"
    Then the turn "an idea for the map" was sent
    And the voice says "Recorded for after 21:00"
    And under his turn it says "Recorded for after 21:00"
    And the talk button reads "Hold to talk" again
    And the line is not waiting for the Mayor

  Scenario: mw-8ifimx.4 AC-3: a Call me request with the mode on says the same
    Given Ideas only is on until 21:00 and the phone's clock says 14:00
    And the Talk line is open with a believable speech recogniser
    When he asks the Mayor to call him
    Then the Call me request was sent
    And the voice says "Recorded for after 21:00"
    And the call line says "Recorded for after 21:00"

  Scenario: mw-8ifimx.4 AC-3: with the mode off the line waits for the Mayor as before
    Given Ideas only is off and the phone's clock says 14:00
    And the Talk line is open with a believable speech recogniser
    When he holds the talk button and says "an idea for the map"
    Then the turn "an idea for the map" was sent
    And the talk button reads "Waiting for the Mayor…"
    And nothing is recorded or spoken
