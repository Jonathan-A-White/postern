Feature: A tapped question goes dead at once, and a new question reads as new (mw-tbx1n.10)

  Scenario: mw-tbx1n.10: after one tap on an option the options are disabled and say what he answered
    Given a question card with the options "Yes" and "No"
    When he taps "Yes"
    Then every option and "Answer in words" is disabled
    And the card says "Answered: Yes" and the time as HH:MM

  Scenario: mw-tbx1n.10: the bead's page no longer offers an answered question
    Given a question on a bead that he answered a minute after it was asked
    When the bead's page opens
    Then the page offers no answer to that question

  Scenario: mw-tbx1n.10: a second question on the same bead shows its own words
    Given a bead whose first question he answered, and which has asked a second one: "Which colour for the door?"
    When the bead's page opens
    Then the card's headline is "Which colour for the door?" with "asked" and the time
    And the bead's title is shown beneath it
    And the card does not say he answered
