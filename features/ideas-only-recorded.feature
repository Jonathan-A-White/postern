Feature: While Ideas only is on, every send says it is recorded for later (mw-8ifimx.4)

  Sends go out unchanged, since the record is the idea, but the app tells him at once that it
  will be acted on after the mode ends: a note under a message or voice note, and the waiting
  label of a tap.

  Scenario: mw-8ifimx.4 AC-2: a text sent in General shows Recorded for after 21:00 and the record still goes
    Given Ideas only is on until 21:00 and the phone's clock says 14:00
    And the General channel is open
    When he writes "an idea about maps" and taps Send
    Then the record reaches the backend with the words "an idea about maps"
    And under his message it says "Recorded for after 21:00"

  Scenario: mw-8ifimx.4 AC-2: a text sent with the mode off has no note
    Given Ideas only is off and the phone's clock says 14:00
    And the General channel is open
    When he writes "an idea about maps" and taps Send
    Then the record reaches the backend with the words "an idea about maps"
    And his message has no Recorded note

  Scenario: mw-8ifimx.4 AC-2: the note stays on the message after a reload and once its record is kept
    Given Ideas only is on until 21:00 and the phone's clock says 14:00
    And the General channel is open
    When he writes "an idea about maps" and taps Send
    And the backend's record of it is kept and the app is reloaded
    Then under his message it says "Recorded for after 21:00"

  Scenario: mw-8ifimx.4 AC-2: a voice note sent on a bead shows the note and still goes
    Given Ideas only is on until 21:00 and the phone's clock says 14:00
    And a bead page is open
    When he holds the mic bar, says "check the build" and lets go
    Then the record reaches the backend with the words "check the build"
    And under his message it says "Recorded for after 21:00"

  Scenario: mw-8ifimx.4 AC-2: a Release tap's label reads Recorded for after 21:00
    Given Ideas only is on until 21:00 and the phone's clock says 14:00
    And a release card is open
    When he taps Release
    Then the card says "Recorded for after 21:00" where Release was

  Scenario: mw-8ifimx.4 AC-2: a Release tap with the mode off still says it is waiting for the factory
    Given Ideas only is off and the phone's clock says 14:00
    And a release card is open
    When he taps Release
    Then the card says "Sent, waiting for the factory" where Release was
