Feature: A banner on every screen while Ideas only is on (mw-8ifimx.4)

  While the mode is on the app says so at the top of every screen, until it ends by itself:
  when the stream says it is off, or when the phone's clock reaches the end with no stream.
  A tap opens Settings, nothing else.

  Scenario: mw-8ifimx.4 AC-1: the banner shows on the channel, a bead page and the Talk line
    Given Ideas only is on until 21:00 and the phone's clock says 14:00
    When the General channel is open
    Then the banner says "Ideas only until 21:00" and "Ideas are kept; to-dos still work"
    When a bead page is open
    Then the bead page wears the banner "Ideas only until 21:00" and "Ideas are kept; to-dos still work"
    When the Talk line is open
    Then the Talk line wears the banner "Ideas only until 21:00" and "Ideas are kept; to-dos still work"

  Scenario: mw-8ifimx.4 AC-1: with the mode off there is no banner
    Given Ideas only is off and the phone's clock says 14:00
    When the General channel is open
    Then there is no banner

  Scenario: mw-8ifimx.4 AC-1: an end on another day names the day
    Given Ideas only is on until tomorrow 07:00 and the phone's clock says 14:00
    When the General channel is open
    Then the banner says "Ideas only until Fri 07:00" and "Ideas are kept; to-dos still work"

  Scenario: mw-8ifimx.4 AC-1: a tap on the banner opens Settings
    Given Ideas only is on until 21:00 and the phone's clock says 14:00
    When the General channel is open
    And he taps the banner
    Then Settings is open with its Ideas only section

  Scenario: mw-8ifimx.4 AC-1: the stream saying it is off removes the banner
    Given Ideas only is on until 21:00 and the phone's clock says 14:00
    When the General channel is open
    And the stream says Ideas only is off
    Then there is no banner

  Scenario: mw-8ifimx.4 AC-1: with no stream the phone's clock passing the end removes the banner
    Given Ideas only is on until 21:00 and the phone's clock says 14:00
    When the General channel is open
    And the phone's clock reaches 21:00
    Then there is no banner
