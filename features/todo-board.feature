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

  Scenario: mw-ev7oyy.7 AC-1: Add a card at a list's foot shows it at once, pending, and queues a todo_add
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    When the To do tab opens
    And he adds the card "Buy bin bags" at the foot of the list "Title of mw-list"
    Then a todo_add for the list "mw-list" titled "Buy bin bags" waits in the outbox
    And the list "Title of mw-list" ends with the pending card "Buy bin bags"

  Scenario: mw-ev7oyy.7 AC-1: Edit on a card's back saves its title, shown at once and pending, as a todo_edit
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And the card "mw-list.1" has the notes "Do it after mw-other.7, then tell the Mayor."
    When the To do tab opens
    And he taps the card "Title of mw-list.1"
    And he taps Edit on the card, changes the title to "Renamed card" and saves
    Then a todo_edit for "mw-list.1" with the title "Renamed card" and no notes waits in the outbox
    And the card "Renamed card" is pending

  Scenario: mw-ev7oyy.7 AC-1: Dragging a card above another reorders the list at once and queues a todo_move
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    When the To do tab opens
    And he drags the card "Title of mw-list.2" above the card "Title of mw-list.1"
    Then a todo_move for "mw-list.2" before "mw-list.1" waits in the outbox
    And the list "Title of mw-list" shows "Title of mw-list.2" then "Title of mw-list.1", the first pending

  Scenario: mw-ev7oyy.7 AC-1: Dragging a card onto another list moves it there and names the list
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And a second list "mw-other" holding one open card
    When the To do tab opens
    And he drags the card "Title of mw-list.1" onto the foot of the list "Title of mw-other"
    Then a todo_move for "mw-list.1" to the list "mw-other" after "mw-other.1" waits in the outbox
    And the list "Title of mw-other" shows "Title of mw-other.1" then "Title of mw-list.1"
    And the list "Title of mw-list" shows only "Title of mw-list.2"

  Scenario: mw-ev7oyy.7 AC-1: Move down on a card's back is the keyboard's way to reorder
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    When the To do tab opens
    And he taps the card "Title of mw-list.1"
    And he taps Move down on the card
    Then a todo_move for "mw-list.1" after "mw-list.2" waits in the outbox

  Scenario: mw-ev7oyy.7 AC-1: A change the Mayor never echoes is rolled back with a short note
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And a move of "mw-list.2" before "mw-list.1" that went three minutes ago and was never echoed
    When the To do tab opens
    Then the list "Title of mw-list" shows "Title of mw-list.1" then "Title of mw-list.2", neither pending
    And a note says the move was not done

  Scenario: mw-ev7oyy.7 AC-1: A change stays pending until the view has reached its echo
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And an edit of "mw-list.2" to "Renamed by hand" that went and was echoed at seq 9, the view being at seq 5
    When the To do tab opens
    Then the card "Renamed by hand" is pending
    When a newer view at seq 9 arrives with "mw-list.2" titled "Renamed by hand"
    Then the card "Renamed by hand" is not pending

  Scenario: mw-ev7oyy.9 AC-1: a card shows its due time on its face, red once it is past
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And the card "mw-list.1" is due tomorrow at 9:00
    And the card "mw-list.2" fell due yesterday at 18:30
    When the To do tab opens
    Then the card "Title of mw-list.1" shows the due time "Tomorrow 9:00", not red
    And the card "Title of mw-list.2" shows the due time "Yesterday 18:30", in red

  Scenario: mw-ev7oyy.9 AC-2: the Due field on a card's back sets the due time as a todo_edit, shown at once and pending
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    When the To do tab opens
    And he taps the card "Title of mw-list.1"
    Then Set due is not offered until a time is picked
    When he picks tomorrow at 17:00 as the due time and taps Set due
    Then a todo_edit for "mw-list.1" with that due time and nothing else waits in the outbox
    When he taps Back on the card
    Then the card "Title of mw-list.1" shows the due time "Tomorrow 17:00", not red
    And the card "Title of mw-list.1" is pending

  Scenario: mw-ev7oyy.9 AC-2: Clear due on the back sends an empty due and takes the time off the card
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And the card "mw-list.1" is due tomorrow at 9:00
    When the To do tab opens
    And he taps the card "Title of mw-list.1"
    And he taps Clear due on the card
    Then a todo_edit for "mw-list.1" with an empty due and nothing else waits in the outbox
    When he taps Back on the card
    Then the card "Title of mw-list.1" shows no due time

  Scenario: mw-ev7oyy.9 AC-1: a list's menu sorts its cards by due, the earliest first and the undated last, and puts the order back
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And the card "mw-list.1" is due tomorrow at 9:00
    And the card "mw-list.2" fell due yesterday at 18:30
    And a card "mw-list.5" with no due time, made last
    When the To do tab opens
    Then the list "Title of mw-list" shows "Title of mw-list.1", "Title of mw-list.2" then "Title of mw-list.5"
    When he chooses Sort by due in the menu of the list "Title of mw-list"
    Then the list "Title of mw-list" now reads "Title of mw-list.2", "Title of mw-list.1" then "Title of mw-list.5"
    And a card in the list "Title of mw-list" cannot be moved up or down while it is sorted by due
    When he chooses Sort by my order in the menu of the list "Title of mw-list"
    Then the list "Title of mw-list" is back to "Title of mw-list.1", "Title of mw-list.2" then "Title of mw-list.5"
