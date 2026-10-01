Feature: The app keeps its own copy of the view up to date from the factory's events (mw-jrx0s.7)

  Scenario: mw-jrx0s.7: a batch applies in seq order
    Given a stored view where "mw-ev.1" is open and the events cursor is at 0
    When one sync pages the batch for seq 2 before the batch for seq 1
    Then "mw-ev.1" reads "open" in the stored view, as seq 2 left it
    And the events cursor is at 2
    And the view was not fetched again

  Scenario: mw-jrx0s.7: a gap in the seqs fetches the view again and goes on
    Given a stored view where "mw-ev.1" is open and the events cursor is at 3
    When a sync pages a batch that starts at seq 7
    Then the view is fetched again from the backend
    And the cursor reads 7
    And a later batch for seq 8 applies without fetching the view

  Scenario: mw-jrx0s.7: Needs you shows a card answered without a refetch
    Given Needs you is open on the question "Pick a colour?" on "mw-ev.1" with the options "Red" and "Blue"
    When a sync pages his answer "Blue" and the event that the card on "mw-ev.1" was answered
    Then the card says "Answered: Blue" and the time as HH:MM
    And its options are disabled
    And the view was never fetched
