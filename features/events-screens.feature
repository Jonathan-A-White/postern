Feature: The bead page and the Talk line hear their events and show them at once, with no refetch (mw-jrx0s.8)

  Scenario: mw-jrx0s.8: a message event shows in the open thread without fetching the bead's detail
    Given the page of "mw-ev.1" is open and its detail has been fetched once
    When a sync pages the Mayor's message "hi from the Mayor" in its channel and the event for it
    Then the thread shows "hi from the Mayor"
    And the bead's detail was not fetched again

  Scenario: mw-jrx0s.8: a comment event brings the new comment into the open thread
    Given the page of "mw-ev.1" is open and its detail has been fetched once
    When a sync pages the event that a comment was added, and the bead now holds "A new comment"
    Then the thread shows "A new comment"

  Scenario: mw-jrx0s.8: a status event changes the status on the open page without fetching the bead's detail
    Given the page of "mw-ev.1" is open and its detail has been fetched once
    When a sync pages the event that the bead was claimed
    Then the page offers no Hold button
    And the bead's detail was not fetched again

  Scenario: mw-jrx0s.8: a card answered event greys the card on the bead's page, and still does after a reload
    Given the page of "mw-ev.1" is open on the question "Pick a colour?" with the options "Red" and "Blue"
    When a sync pages his answer "Blue" and the event that the card on "mw-ev.1" was answered
    Then the card says "Answered: Blue" and the time as HH:MM
    And the card's options are disabled
    When the page is opened again
    Then the card still says "Answered: Blue" and the time as HH:MM
    And the card's options are still disabled

  Scenario: mw-jrx0s.8: a RAN event shows the step's line under its comment
    Given the page of "mw-ev.1" is open on a hands step "step-1" not yet run
    When a sync pages the event that step "step-1" ran and the bead now holds its RAN comment
    Then the step's comment says it ran, exit 0
