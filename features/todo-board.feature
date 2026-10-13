Feature: The To do board holds the Governor's own outside things, a column per list (mw-ev7oyy.4)

  Scenario: mw-ev7oyy.4 AC-2: To do shows each list as a column of its open cards and counts them on the tab
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    When the To do tab opens
    Then the board has a column titled "Title of mw-list" holding "Title of mw-list.1" and "Title of mw-list.2"
    And no card named "Title of mw-list.3" or "Title of mw-list.4" is shown
    And the To do tab shows the count 2

  Scenario: mw-ev7oyy.4 AC-2: Done queues a close for that card and greys it until the view drops it
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    When the To do tab opens
    And he taps Done on "Title of mw-list.1"
    Then a close action for "mw-list.1" waits in the outbox
    And the card "Title of mw-list.1" says "Done, waiting for the Mayor" and offers no Done button
    And the card "Title of mw-list.2" still offers Done
    When a newer view arrives without "mw-list.1"
    Then no card named "Title of mw-list.1" is shown

  Scenario: mw-ev7oyy.4 AC-6: a tap on a card turns it over to its back, and Back turns it again
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And the card "mw-list.1" has the notes "Do it after mw-other.7, then tell the Mayor."
    When the To do tab opens
    And he taps the card "Title of mw-list.1"
    Then the back of the card shows the notes "Do it after" and a link to the bead "mw-other.7"
    When he taps Back on the card
    Then the board shows the front of "Title of mw-list.1" again

  Scenario: mw-ev7oyy.4: with nothing on any list the board says so
    Given a view with no to do cards
    When the To do tab opens
    Then the board says "Nothing on your lists."
    And the To do tab shows no count
