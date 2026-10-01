Feature: The Share screen offers a new channel first, then the channel he shared to last

  Scenario: mw-dw0i6.2: New channel opens a named channel with the image in its composer
    Given the factory is live and a screenshot was shared into Postern
    When the Share screen is opened and "New channel" is tapped and "Sprint notes" is typed and "Start" is tapped
    Then the channel "Sprint notes" opens with the screenshot in its composer
    And the parked share is gone

  Scenario: mw-dw0i6.2: the channel shared to last is first and says Last used
    Given the factory is live and a screenshot was shared into Postern
    When the screenshot is shared to the channel "desktop move"
    And a second screenshot is shared into Postern and the Share screen is opened
    Then the first row says "New channel" and the second is "desktop move" marked "Last used"
    And "desktop move" is listed once

  Scenario: mw-dw0i6.2: with no channel remembered the list is as before
    Given the factory is live and a screenshot was shared into Postern
    When the Share screen is opened
    Then the first row says "New channel" and then comes "Factory"
    And "Last used" is nowhere on the screen

  Scenario: mw-dw0i6.2: a remembered channel with no message yet is still offered
    Given the factory is live and a screenshot was shared into Postern
    When the screenshot is shared to the new channel "Fresh idea"
    And a second screenshot is shared into Postern and the Share screen is opened
    Then the first row says "New channel" and the second is "Fresh idea" marked "Last used"
    And "Fresh idea" is listed once
