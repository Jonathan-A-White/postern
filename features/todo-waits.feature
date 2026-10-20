Feature: A To do card that waits on an unfinished bead says so and offers no Done (mw-bdxfn5)

  Scenario: mw-bdxfn5 AC-1: a card waiting on an unfinished story says Waits on, links it, sits below the doable card and offers no Done
    Given a list "mw-a" whose first card "mw-a.1" waits on the open story "mw-blk" and whose second card "mw-a.2" waits on nothing
    When the To do tab opens
    Then the row "Do now" shows "Title of mw-a.2" then "Title of mw-a.1"
    And the card "Title of mw-a.1" says "Waits on:" and links "Title of mw-blk" to "mw-blk"
    And the card "Title of mw-a.1" offers no Done
    And the card "Title of mw-a.2" offers Done

  Scenario: mw-bdxfn5 AC-1: the back of a waiting card offers no Done button either
    Given a list "mw-a" whose first card "mw-a.1" waits on the open story "mw-blk" and whose second card "mw-a.2" waits on nothing
    When the To do tab opens
    And he turns over "Title of mw-a.1"
    Then the back of "Title of mw-a.1" has no Done button

  Scenario: mw-bdxfn5 AC-2: when the wait finishes the card is a normal doable card again with no tap
    Given a list "mw-a" whose first card "mw-a.1" waits on the open story "mw-blk" and whose second card "mw-a.2" waits on nothing
    When the To do tab opens
    And the next view has the story "mw-blk" closed
    Then the card "Title of mw-a.1" offers Done
    And the card "Title of mw-a.1" no longer says "Waits on:"
    And the row "Do now" shows "Title of mw-a.1" then "Title of mw-a.2"

  Scenario: mw-bdxfn5 AC-3: a card with no waits looks as it did, with its Done and no Waits on
    Given a list "mw-a" whose first card "mw-a.1" waits on nothing and whose second card "mw-a.2" waits on nothing
    When the To do tab opens
    Then the row "Do now" shows "Title of mw-a.1" then "Title of mw-a.2"
    And the card "Title of mw-a.1" offers Done
    And the card "Title of mw-a.1" no longer says "Waits on:"

  Scenario: mw-ea9izd AC-1: a waiting to do's own page says Waits on, links the story and offers no Done
    Given a waiting to do "mw-t.1" that waits on the open story "mw-blk"
    When he opens the page of "mw-t.1"
    Then the page says "Waits on:" and links "Title of mw-blk" to "mw-blk"
    And the page has no Done button

  Scenario: mw-ea9izd AC-1: a waiting to do's Needs you card says Waits on, links the story and offers no Done
    Given a waiting to do "mw-t.1" that waits on the open story "mw-blk"
    And Needs you holds a step card for "mw-t.1"
    When the Needs you tab opens
    Then the card of "mw-t.1" says "Waits on:" and links "Title of mw-blk" to "mw-blk"
    And the card of "mw-t.1" has no Done button

  Scenario: mw-ea9izd AC-1: when the wait closes the page offers Done again with the next view
    Given a waiting to do "mw-t.1" that waits on the open story "mw-blk"
    When he opens the page of "mw-t.1"
    And the next view has the story "mw-blk" closed
    Then the page offers a Done button
    And the page no longer says "Waits on:"

  Scenario: mw-ea9izd AC-1: when the wait closes the Needs you card offers Done again with the next view
    Given a waiting to do "mw-t.1" that waits on the open story "mw-blk"
    And Needs you holds a step card for "mw-t.1"
    When the Needs you tab opens
    And the next view has the story "mw-blk" closed
    Then the card of "mw-t.1" offers a Done button
