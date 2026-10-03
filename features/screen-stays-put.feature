Feature: The page is never left scrolled (mw-jkrnxu.2)

  Scenario: mw-jkrnxu.2: a page scrolled by the keyboard is put back at the top when the window resizes
    Given a page the keyboard has scrolled down, with the scroll guard on
    When the window resizes
    Then the document, the body and the Shell root are back at scrollTop 0

  Scenario: mw-jkrnxu.2: a page scrolled while he was away is put back when the app returns to the foreground
    Given a page the keyboard has scrolled down, with the scroll guard on
    When the app becomes visible again
    Then the document, the body and the Shell root are back at scrollTop 0

  Scenario: mw-jkrnxu.2: a page scrolled by a focus is put back when the box loses focus
    Given a page the keyboard has scrolled down, with the scroll guard on
    When a box loses focus
    Then the document, the body and the Shell root are back at scrollTop 0

  Scenario: mw-jkrnxu.2: a page restored from the back-forward cache is put back at the top
    Given a page the keyboard has scrolled down, with the scroll guard on
    When the page is shown again
    Then the document, the body and the Shell root are back at scrollTop 0

  Scenario: mw-jkrnxu.2: a page that scrolls itself is put back at once
    Given a page the keyboard has scrolled down, with the scroll guard on
    When the Shell root is scrolled
    Then the document, the body and the Shell root are back at scrollTop 0

  Scenario: mw-jkrnxu.2: once the guard is stopped the page is left alone
    Given a page the keyboard has scrolled down, with the scroll guard on
    When the guard is stopped and the window resizes
    Then the Shell root is still scrolled

  Scenario: mw-jkrnxu.2: the shipped page cannot be scrolled and its focus never scrolls
    Given the app's stylesheet, page and screens as shipped
    Then html, body and the root are overflow clip, not hidden
    And the Shell root is overflow clip and named for the guard
    And the viewport meta says interactive-widget resizes-content
    And no screen focuses a box with autoFocus or a focus call that may scroll
