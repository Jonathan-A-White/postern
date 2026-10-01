Feature: Back brings him to the position he left, on every screen with a scroll (mw-f758y.35)

  Scenario: mw-f758y.35: a screen scrolled down is scrolled to the same place when he comes back to it
    Given a screen with a long list, scrolled to 300
    When he goes to another screen and comes back
    Then the list is scrolled to 300

  Scenario: mw-f758y.35: each address keeps its own position
    Given a screen with a long list, scrolled to 300
    When he goes to a second address, scrolls it to 120, and returns to the first
    Then the list is scrolled to 300

  Scenario: mw-f758y.35: a list that fills in after he comes back still ends where he left it
    Given a screen with a long list, scrolled to 300
    When he goes to another screen and comes back while the list is still short
    And the rest of the list arrives
    Then the list is scrolled to 300

  Scenario: mw-f758y.35: an address he never scrolled opens as it always did
    Given a screen with a long list, never scrolled
    When he goes to another screen and comes back
    Then the list is scrolled to 0

  Scenario: mw-f758y.35: scrolling again after he comes back is not undone by the old position
    Given a screen with a long list, scrolled to 300
    When he goes to another screen and comes back while the list is still short
    And he scrolls the short list himself
    And the rest of the list arrives
    Then the list is scrolled to where he put it
