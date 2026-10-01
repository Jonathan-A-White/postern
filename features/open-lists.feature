Feature: Open grillings and open maps are one tap away (mw-f758y.30)

  Scenario: mw-f758y.30: Grillings · 2 lists the open grillings, and the one with a card opens it
    Given a view with two open grillings, one with a decision card, and a closed grilling
    When the Map opens
    Then a "Grillings · 2" button is shown, closed
    When the "Grillings · 2" button is tapped
    Then the Open grillings list shows both grillings and not the closed one
    And the grilling with a card shows its question line
    When the question line is tapped
    Then the card opens with its answers

  Scenario: mw-f758y.30: Open maps · 1 lists the open map that is not a grilling
    Given a view with an open map, an open grilling that is also a map, a finished map and a closed map
    When the Map opens
    Then an "Open maps · 1" button is shown, closed
    When the "Open maps · 1" button is tapped
    Then the Open maps list shows the open map and nothing else

  Scenario: mw-f758y.30: Needs you has the same two chips
    Given a view with two open grillings, one with a decision card, and a closed grilling
    When the Needs screen opens
    Then a "Grillings · 2" button is shown, closed
