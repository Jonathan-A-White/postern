Feature: The bottom menu stays on every screen (mw-tbx1n.12)

  Scenario: mw-tbx1n.12: a bead's page on a phone still has the five places along the bottom, under its composer
    Given a phone 390 px wide and a view with a bead
    When the bead's page opens inside the shell
    Then the bottom menu offers "Needs you", "Map", "Channels", "Search" and "Me"
    And "Map" is the place marked as current
    And the composer sits above the bottom menu and only the menu keeps the bottom safe-area inset
    And the header still offers Back

  Scenario: mw-tbx1n.12: a thread on a phone still has the five places along the bottom, under its composer
    Given a phone 390 px wide and a view with a bead
    When a thread opens inside the shell
    Then the bottom menu offers "Needs you", "Map", "Channels", "Search" and "Me"
    And "Channels" is the place marked as current
    And the composer sits above the bottom menu and only the menu keeps the bottom safe-area inset
    And the header still offers Back

  Scenario: mw-tbx1n.12: on a wide screen the composer keeps the safe-area inset and there is no bottom menu
    Given a wide screen and a view with a bead
    When a thread opens inside the shell
    Then there is no bottom menu
    And the composer keeps the bottom safe-area inset
