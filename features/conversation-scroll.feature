Feature: A conversation scrolls inside its own box, never the page (mw-jkrnxu.1)

  Scenario: mw-jkrnxu.1: a new message scrolls the conversation's own box to the bottom and the page stays put
    Given a conversation of 3 messages open in its own scroll box
    When a new message arrives
    Then the conversation's box is scrolled to its bottom
    And the page itself is not scrolled, and no scrollIntoView was asked of the page

  Scenario: mw-jkrnxu.1: a conversation that opens scrolls its own box to the newest message
    Given a conversation of 3 messages open in its own scroll box
    Then the conversation's box is scrolled to its bottom
    And the page itself is not scrolled, and no scrollIntoView was asked of the page

  Scenario: mw-jkrnxu.1: a conversation told not to scroll on open leaves its box alone until a new message comes
    Given a conversation of 3 messages open in its own scroll box that is not to scroll on open
    Then the conversation's box is scrolled to the top
    When a new message arrives
    Then the conversation's box is scrolled to its bottom

  Scenario: mw-q6n8m0.6: Show earlier keeps the messages he was reading where they were
    Given a conversation of 100 messages open in its own scroll box
    When he scrolls to the top and taps Show earlier
    Then the 40 earlier messages are above and the box is scrolled past them
