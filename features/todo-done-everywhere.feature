Feature: Every open to do shows Done wherever he opens it (mw-ev7oyy.42)

  Scenario: mw-ev7oyy.42 AC-1: a to do bead's own page offers Done
    Given a to do bead "mw-trip.1" under the epic "mw-trip" that is not one of his lists
    When he opens the page of "mw-trip.1"
    Then the page offers a Done button

  Scenario: mw-ev7oyy.42 AC-1: a to do bead with a child of its own still offers Done on its page
    Given a to do bead "mw-trip.1" under the epic "mw-trip" that is not one of his lists
    And "mw-trip.1" has a closed child "mw-trip.1.1"
    When he opens the page of "mw-trip.1"
    Then the page offers a Done button

  Scenario: mw-ev7oyy.42 AC-1: a to do bead's card in Needs you offers Done
    Given a to do bead "mw-trip.1" under the epic "mw-trip" that is not one of his lists
    And Needs you holds a step card for "mw-trip.1"
    When the Needs you tab opens
    Then the card of "mw-trip.1" offers a Done button

  Scenario: mw-ev7oyy.42 AC-1: a to do bead's card on the To do board offers Done
    Given a to do bead "mw-trip.1" under the epic "mw-trip" that is not one of his lists
    When the To do tab opens
    Then the board offers Done on "Title of mw-trip.1"

  Scenario: mw-ev7oyy.42 AC-2: Done on a to do bead under an epic that is not one of his lists closes it
    Given a to do bead "mw-trip.1" under the epic "mw-trip" that is not one of his lists
    When he opens the page of "mw-trip.1"
    And he taps Done on the page
    Then a close action for "mw-trip.1" waits in the outbox
    And the page says Done is waiting for the Mayor and offers no Done button

  Scenario: mw-ev7oyy.42 AC-2: Done on the Needs you card of a to do bead closes it
    Given a to do bead "mw-trip.1" under the epic "mw-trip" that is not one of his lists
    And Needs you holds a step card for "mw-trip.1"
    When the Needs you tab opens
    And he taps Done on the card of "mw-trip.1"
    Then a close action for "mw-trip.1" waits in the outbox

  Scenario: mw-ev7oyy.42 AC-1: a bead that is not a to do has no Done on its page
    Given a plain bead "mw-trip.2" under the epic "mw-trip" that is not one of his lists
    When he opens the page of "mw-trip.2"
    Then the page has no Done button
