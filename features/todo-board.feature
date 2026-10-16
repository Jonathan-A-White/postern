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

  Scenario: mw-ev7oyy.15 AC-2: a card says in words when it is due or overdue, and is never red
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And the card "mw-list.1" is due tomorrow at 9:00
    And the card "mw-list.2" fell due yesterday at 18:30
    When the To do tab opens
    Then the card "Title of mw-list.1" says "due tomorrow" and is not overdue
    And the card "Title of mw-list.2" says "overdue since yesterday" and is overdue
    And neither card's due line is red

  Scenario: mw-ev7oyy.9 AC-2: the Due field on a card's back sets the due time as a todo_edit, shown at once and pending
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    When the To do tab opens
    And he taps the card "Title of mw-list.1"
    Then Set due is not offered until a time is picked
    When he picks tomorrow at 17:00 as the due time and taps Set due
    Then a todo_edit for "mw-list.1" with that due time and nothing else waits in the outbox
    When he taps Back on the card
    Then the card "Title of mw-list.1" says "due tomorrow" and is not overdue
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
    And the card "mw-list.1" is due in 5 days at 9:00
    And the card "mw-list.2" is due in 4 days at 9:00
    And a card "mw-list.5" with no due time, made last
    When the To do tab opens
    Then the list "Title of mw-list" shows "Title of mw-list.1", "Title of mw-list.2" then "Title of mw-list.5"
    When he chooses Sort by due in the menu of the list "Title of mw-list"
    Then the list "Title of mw-list" now reads "Title of mw-list.2", "Title of mw-list.1" then "Title of mw-list.5"
    And a card in the list "Title of mw-list" cannot be moved up or down while it is sorted by due
    When he chooses Sort by my order in the menu of the list "Title of mw-list"
    Then the list "Title of mw-list" is back to "Title of mw-list.1", "Title of mw-list.2" then "Title of mw-list.5"

  Scenario: mw-ev7oyy.15 AC-1: the star on a card marks it important with one tap and a second tap clears it
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    When the To do tab opens
    And he taps the star on "Title of mw-list.2"
    Then a todo_edit for "mw-list.2" marking it important and nothing else waits in the outbox
    And the star on "Title of mw-list.2" now offers to clear it
    And the card "Title of mw-list.2" is pending
    When he taps the star on "Title of mw-list.2"
    Then the outbox holds the todo_edit marking "mw-list.2" important, then one clearing it

  Scenario: mw-ev7oyy.15 AC-1: a card the view says is important shows its star filled, and it survives a reload
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And the card "mw-list.2" is important in the view
    When the To do tab opens
    Then the star on "Title of mw-list.2" offers to clear it
    And the star on "Title of mw-list.1" offers to mark it important

  Scenario: mw-ev7oyy.15 AC-3: a card due within 48 hours or overdue floats up, soonest first, then the important ones, then the rest
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And a card "mw-list.5" that is important, made last
    And a card "mw-list.6" due tomorrow at 9:00, made last
    And a card "mw-list.7" that fell due yesterday at 18:30, made last
    And a card "mw-list.8" due in 5 days at 9:00, made last
    When the To do tab opens
    Then the list "Title of mw-list" reads in order "Title of mw-list.7", "Title of mw-list.6", "Title of mw-list.5", "Title of mw-list.8", "Title of mw-list.1" then "Title of mw-list.2"

  Scenario: mw-ev7oyy.12 AC-1: a card whose notes end in an Open: line shows a chip for each link, and a tap opens the link, not the back
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And the card "mw-list.1" has the notes "Deep discipleship.\n\nOpen: [Kindle](kindle://book?action=open&asin=B0C74TJ712) · [Audible](https://www.audible.com/pd/B0CC36V9KG)"
    When the To do tab opens
    Then the card "Title of mw-list.1" shows the chips "Kindle" and "Audible" under its title
    And the card "Title of mw-list.1" has the chip links named "Open in Kindle" and "Open in Audible"
    When he taps the chip "Open in Audible" on the card "Title of mw-list.1"
    Then the chip "Open in Audible" opens "https://www.audible.com/pd/B0CC36V9KG" in a new tab
    And the chip "Open in Kindle" opens "kindle://book?action=open&asin=B0C74TJ712" in the same tab
    And the card "Title of mw-list.1" is still on its front, not done, with nothing waiting in the outbox

  Scenario: mw-ev7oyy.12 AC-1: a card with no Open: line shows no chips
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And the card "mw-list.1" has the notes "A plain note with https://example.com/bare in it."
    When the To do tab opens
    Then the card "Title of mw-list.1" shows no chips

  Scenario: mw-ev7oyy.12 AC-1: an Open: line of five links shows the first four
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And the card "mw-list.1" has the notes "Open: [One](https://one.example/), [Two](https://two.example/), [Three](https://three.example/), [Four](https://four.example/), [Five](https://five.example/)"
    When the To do tab opens
    Then the card "Title of mw-list.1" shows the chips "One", "Two", "Three" and "Four" under its title

  Scenario: mw-ev7oyy.12 AC-1: an Open: line past the view's short summary of the notes still shows its chips
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And the card "mw-list.1" has long notes, longer than the view's summary, ending "Open: [Kindle](kindle://book?action=open&asin=B0C74TJ712) · [Audible](https://www.audible.com/pd/B0CC36V9KG)"
    When the To do tab opens
    Then the card "Title of mw-list.1" shows the chips "Kindle" and "Audible" under its title

  Scenario: mw-ev7oyy.12 AC-6: a tel: chip opens in the same tab, for the phone's dialer
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And the card "mw-list.1" has the notes "Open: [Call the plumber](tel:+15555550123)"
    When the To do tab opens
    Then the chip "Open in Call the plumber" opens "tel:+15555550123" in the same tab

  Scenario: mw-ev7oyy.14 AC-1: a list whose epic has a long title is headed by its short name, the whole title on its menu
    Given a list "mw-long" whose epic title is "Governor's Discipleship Institute list (Deep Discipleship, Weeks 4-6): last week's unfinished work and this week's pre-work, due at the next group meeting"
    When the To do tab opens
    Then the board has a column named "Governor's Discipleship Institute list" whose header is one line, cut with an ellipsis
    And the menu of the list "Governor's Discipleship Institute list" gives its whole title "Governor's Discipleship Institute list (Deep Discipleship, Weeks 4-6): last week's unfinished work and this week's pre-work, due at the next group meeting"

  Scenario: mw-ev7oyy.14 AC-1: a list whose epic has a todo_name is headed by that name
    Given a list "mw-long" whose epic title is "Governor's Discipleship Institute list (Deep Discipleship, Weeks 4-6): last week's unfinished work and this week's pre-work, due at the next group meeting"
    And the epic "mw-long" has the todo_name "Deep Discipleship"
    When the To do tab opens
    Then the board has a column named "Deep Discipleship" whose header is one line, cut with an ellipsis

  Scenario: mw-ev7oyy.14 AC-2: a card is one row with a small round check named Done and its title, and a tap on the check does what Done did
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    When the To do tab opens
    Then the card "Title of mw-list.1" has the round check "Done: Title of mw-list.1" and no button named just Done
    When he taps the round check of the card "Title of mw-list.1"
    Then a close action for "mw-list.1" waits in the outbox
    And the card "Title of mw-list.1" says "Done, waiting for the Mayor" and offers no Done button
    And the card "Title of mw-list.2" still offers Done

  Scenario: mw-ev7oyy.14 AC-1: the swipe hint shows until he has swiped once, and then not again
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And a second list "mw-other" holding one open card
    When the To do tab opens
    Then the board hints "Swipe sideways for the next list. Hold a card to move it."
    When he swipes the lists sideways
    Then the board shows no swipe hint
    When the To do tab is opened again
    Then the board still shows no swipe hint

  Scenario: mw-ev7oyy.16 AC-1: a list groups its cards into Today, Soon and Someday, each with its count, Today open and the others folded
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And a card "mw-list.5" that is important, made last
    And a card "mw-list.6" due in 5 days at 9:00, made last
    And a card "mw-list.7" that fell due yesterday at 18:30, made last
    And a card "mw-list.8" due today at 23:00, made last
    When the To do tab opens with the groups as he first finds them
    Then the list "Title of mw-list" has the groups "Fold Today, 2 cards / Open Soon, 2 cards / Open Someday, 2 cards"
    And the list "Title of mw-list" shows only "Title of mw-list.7" then "Title of mw-list.8"

  Scenario: mw-ev7oyy.16 AC-1: a group with no cards is not shown
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    When the To do tab opens with the groups as he first finds them
    Then the list "Title of mw-list" has the groups "Open Someday, 2 cards"

  Scenario: mw-ev7oyy.16 AC-2: a folded group opens with one tap, and each list keeps what he opened across a reload
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And a card "mw-list.5" that is important, made last
    And a second list "mw-other" holding one open card
    When the To do tab opens with the groups as he first finds them
    And he taps "Open Soon, 1 card" on the list "Title of mw-list"
    Then the list "Title of mw-list" has the groups "Fold Soon, 1 card / Open Someday, 2 cards"
    And the list "Title of mw-list" shows only "Title of mw-list.5"
    When the To do tab is opened again
    Then the list "Title of mw-list" still has the groups "Fold Soon, 1 card / Open Someday, 2 cards"
    And the list "Title of mw-other" keeps the groups "Open Someday, 1 card"

  Scenario: mw-ev7oyy.16 AC-3: a card's back moves it to Today for today only, and the next day it is back in its own group
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    When the To do tab opens with the groups as he first finds them
    And he taps "Open Someday, 2 cards" on the list "Title of mw-list"
    And he taps the card "Title of mw-list.1"
    And he taps "Move to Today" on the card's back
    And he taps Back on the card
    Then the list "Title of mw-list" has the groups "Fold Today, 1 card / Fold Someday, 1 card"
    And the list "Title of mw-list" shows only "Title of mw-list.1" then "Title of mw-list.2"
    When it is the next day and the To do tab is opened again
    Then the list "Title of mw-list" still has the groups "Fold Someday, 2 cards"
    And the list "Title of mw-list" again shows only "Title of mw-list.1" then "Title of mw-list.2"

  Scenario: mw-ev7oyy.16 AC-3: a card tapped into Today offers Back to its own group, and that puts it back
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    When the To do tab opens with the groups as he first finds them
    And he taps "Open Someday, 2 cards" on the list "Title of mw-list"
    And he taps the card "Title of mw-list.1"
    And he taps "Move to Today" on the card's back
    Then the card's back offers "Back to its own group" and not "Move to Today"
    When he then taps "Back to its own group" on the card's back
    Then the list "Title of mw-list" has the groups "Fold Someday, 2 cards"

  Scenario: mw-ev7oyy.16 AC-1: a card added to a folded Someday is seen at once, pending
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    When the To do tab opens with the groups as he first finds them
    And he adds the card "Buy bin bags" at the foot of the list "Title of mw-list"
    Then a todo_add for the list "mw-list" titled "Buy bin bags" waits in the outbox
    And the list "Title of mw-list" ends with the pending card "Buy bin bags"


  Scenario: mw-ev7oyy.22 AC-1: a card whose notes have a Text: line shows a Text button that opens his texting app to the person with the message filled in
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And the card "mw-list.1" has the notes "Ask Dad about Saturday.\n\nText: Dad +1 516-555-0123 | Hi Dad & Mum? Saturday #1\nLove 👍"
    When the To do tab opens
    Then the card "Title of mw-list.1" shows a Text button named "Text Dad" under its title
    And the Text button "Text Dad" opens "sms:+15165550123?body=Hi%20Dad%20%26%20Mum%3F%20Saturday%20%231%0ALove%20%F0%9F%91%8D" in the same tab
    When he taps the Text button "Text Dad" on the card "Title of mw-list.1"
    Then the card "Title of mw-list.1" is still on its front, not done, with nothing waiting in the outbox

  Scenario: mw-ev7oyy.22 AC-1: a Text: line with no number opens his texting app with the message only, for him to pick the person
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And the card "mw-list.1" has the notes "Text: Running late & sorry, there by 7?"
    When the To do tab opens
    Then the Text button "Text" opens "sms:?body=Running%20late%20%26%20sorry%2C%20there%20by%207%3F" in the same tab

  Scenario: mw-ev7oyy.22 AC-2: a card with no Text: line shows no Text button
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And the card "mw-list.1" has the notes "Text Dad about Saturday.\n\nOpen: [Call Dad](tel:+15165550123)"
    When the To do tab opens
    Then the card "Title of mw-list.1" shows the chip "Call Dad" and no Text button

  Scenario: mw-ev7oyy.22 AC-1: a Text: line past the view's short summary of the notes still shows its Text button
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And the card "mw-list.1" has long notes, longer than the view's summary, ending "Text: Dad +15165550123 | Hi Dad"
    When the To do tab opens
    Then the Text button "Text Dad" opens "sms:+15165550123?body=Hi%20Dad" in the same tab

  Scenario: mw-ev7oyy.23 AC-2: on Android the Text button opens Google Voice by name, not the phone's default texting app
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And the phone is an Android phone running Chrome
    And the card "mw-list.1" has the notes "Text: Dad | Hi Dad, would Saturday suit you?"
    When the To do tab opens
    Then the card "Title of mw-list.1" shows a Text button named "Text Dad" under its title
    And the Text button "Text Dad" opens "intent:?body=Hi%20Dad%2C%20would%20Saturday%20suit%20you%3F#Intent;scheme=sms;package=com.google.android.apps.googlevoice;S.sms_body=Hi%20Dad%2C%20would%20Saturday%20suit%20you%3F;S.browser_fallback_url=sms%3A%3Fbody%3DHi%2520Dad%252C%2520would%2520Saturday%2520suit%2520you%253F;end" in the same tab
