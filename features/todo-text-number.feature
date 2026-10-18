Feature: A Text: line with a number opens Voice to that person; a name with no number can be given one on the card (mw-ev7oyy.35)

  Scenario: mw-ev7oyy.35 AC-1: a Text: line the home gave a number opens the texting app to that number with the draft, and shows no number field
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And the card "mw-list.1" has the notes "Text: Matthew Steele <+15551230001> | Running ten late"
    When the To do tab opens
    Then the Text button "Text Matthew Steele" opens "sms:+15551230001?body=Running%20ten%20late" in the same tab
    And the card "Title of mw-list.1" shows no number field

  Scenario: mw-ev7oyy.35 AC-1: a name-only Text: line shows the reason the home wrote and one field to add the number
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And the card "mw-list.1" has the notes "Text: Matthew | Running ten late\nContacts: two contacts match Matthew"
    When the To do tab opens
    Then the card "Title of mw-list.1" says "Two contacts match Matthew"
    And the card "Title of mw-list.1" has the field "Add Matthew's number"

  Scenario: mw-ev7oyy.35 AC-2: a saved number goes to the home as one to do action, and once the home has written it the line opens Voice to the number and the field is gone
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And the card "mw-list.1" has the notes "Text: Matthew | Running ten late\nContacts: two contacts match Matthew"
    When the To do tab opens
    And he types "(555) 123-0001" into "Add Matthew's number" on the card "Title of mw-list.1" and taps "Save number"
    Then one todo_edit for "mw-list.1" waits in the outbox with the notes "Text: Matthew <+15551230001> | Running ten late"
    And the card "Title of mw-list.1" says "Saving Matthew's number" in place of the field
    When the home answers with the notes "Text: Matthew <+15551230001> | Running ten late"
    Then the Text button "Text Matthew" opens "sms:+15551230001?body=Running%20ten%20late" in the same tab
    And the card "Title of mw-list.1" shows no number field

  Scenario: mw-ev7oyy.35 AC-2: a number that is not a number is refused on the phone with a short reason and nothing is sent
    Given a view with a list "mw-list" holding two open cards, a closed card and a card that is not a to do
    And the card "mw-list.1" has the notes "Text: Matthew | Running ten late\nContacts: no contact named Matthew"
    When the To do tab opens
    And he types "call me" into "Add Matthew's number" on the card "Title of mw-list.1" and taps "Save number"
    Then the card "Title of mw-list.1" says "A number has only digits"
    And nothing waits in the outbox
