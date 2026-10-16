Feature: An iced bead reads Iced, an epic folds its iced beads into one Icebox row, and the bead page offers Thaw (mw-njb33n.1)

  Scenario: mw-njb33n.1 AC1: an iced bead reads Iced whatever its status
    Given a deferred bead labelled icebox and an open bead labelled icebox
    Then both read "Iced"
    And a deferred bead without the icebox label reads "Held"

  Scenario: mw-njb33n.1 AC1: an epic with two iced stories shows one Icebox (2) row, closed, that opens on a tap
    Given an epic with one live story and two iced stories
    When the epic opens on the Map
    Then a button "Icebox (2)" is shown, closed
    And the iced stories are not listed
    When the "Icebox (2)" button is tapped
    Then the Icebox lists both iced stories
    And the live story is still on the board

  Scenario: mw-njb33n.1 AC1: an epic's Release counts the held stories, not the iced ones
    Given an epic with one live story and two iced stories
    When the epic opens on the Map
    Then no Release button is offered on the Map

  Scenario: mw-njb33n.1 AC1: the List view folds the iced stories the same way
    Given an epic with one live story and two iced stories
    When the epic opens on the Map as a list
    Then a button "Icebox (2)" is shown, closed
    And the iced stories are not listed

  Scenario: mw-njb33n.1 AC1: an iced story's page offers Thaw, and a tap sends the thaw
    Given the bead page of an iced story
    Then the page offers the button "Thaw"
    And the page says "Iced"
    When he taps "Thaw"
    Then the thaw for the story is sent
    And the page no longer offers Thaw

  Scenario: mw-njb33n.1 AC1: a story that is not iced has no Thaw
    Given the bead page of a story that is not iced
    Then the page has no Thaw button
