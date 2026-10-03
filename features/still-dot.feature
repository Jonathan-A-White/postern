Feature: The live dots stay still, so an idle screen draws no frames (mw-1ox07o.2)

  Scenario: AC-1: the live dot in the header does not pulse while the factory is live
    Given the factory is live
    When the header's live badge is shown
    Then its dot does not animate

  Scenario: AC-2: the dot on a working bead card does not pulse
    Given a bead that is in progress
    When its card is shown
    Then the card's dot does not animate
