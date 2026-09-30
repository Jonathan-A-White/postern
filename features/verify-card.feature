Feature: A verify card says what a tap does, with the steps beside it (mw-tbx1n.15)

  Scenario: mw-tbx1n.15: a verify card shows How to check it and the button I checked it: it works
    Given a verify card whose steps are "1. Open the Me place" and an image
    Then the card has the heading "How to check it" above the steps
    And the card offers "I checked it: it works" and no button called "Verified"
    And the image in the steps is set to the card's full width

  Scenario: mw-tbx1n.15: tapping I checked it: it works sends the verified action once
    Given a verify card whose steps are "1. Open the Me place" and an image
    When he taps "I checked it: it works"
    Then one verified action for that bead is sent
    And the card says it is waiting for the factory, with no button to tap

  Scenario: mw-tbx1n.15: a verify card with no steps has no How to check it heading
    Given a verify card with no steps
    Then the card has no "How to check it" heading

  Scenario: mw-tbx1n.15: the approve chip and button share one word
    Given an approve card
    Then the chip and the button both say "Release" and nothing says "Approve"
