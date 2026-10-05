Feature: A verify card says what a tap does, with the steps beside it (mw-tbx1n.15, mw-581qad.1)

  Scenario: mw-tbx1n.15: a verify card shows How to check it and a button Verified
    Given a verify card whose steps are "1. Open the Me place" and an image
    Then the card has the heading "How to check it" above the steps
    And the card offers "Verified" and no button called "Yes, verified"
    And the image in the steps is set to the card's full width

  Scenario: mw-581qad.1: tapping Verified asks first and sends nothing until he says yes
    Given a verify card whose steps are "1. Open the Me place" and an image
    When he taps "Verified"
    Then the card asks "Mark mw-v verified? The Mayor is told you checked it and it works." with "Yes, verified" and "Not yet"
    And nothing is sent

  Scenario: mw-581qad.1: Not yet folds the question back
    Given a verify card whose steps are "1. Open the Me place" and an image
    When he taps "Verified"
    And he taps "Not yet"
    Then the card offers "Verified" again and nothing is sent

  Scenario: mw-581qad.1: the question folds back by itself after 8 seconds untouched
    Given a verify card whose steps are "1. Open the Me place" and an image
    When he taps "Verified"
    And 8 seconds pass
    Then the card offers "Verified" again and nothing is sent

  Scenario: mw-581qad.1: Yes, verified sends one VERIFIED message to the bead's channel
    Given a verify card whose steps are "1. Open the Me place" and an image
    When he taps "Verified"
    And he taps "Yes, verified" twice
    Then one message to the channel of that bead says "VERIFIED (tapped Verified in Needs you)"
    And the card says it is waiting for the factory, with no button to tap

  Scenario: mw-581qad.1: a verify card waiting on the Mayor offers Verified too
    Given a verify card waiting on the Mayor to check the landing
    Then the card says "Waits on the Mayor" and offers "Verified"

  Scenario: mw-tbx1n.15: a verify card with no steps has no How to check it heading
    Given a verify card with no steps
    Then the card has no "How to check it" heading

  Scenario: mw-tbx1n.15: the approve chip and button share one word
    Given an approve card
    Then the chip and the button both say "Release" and nothing says "Approve"
