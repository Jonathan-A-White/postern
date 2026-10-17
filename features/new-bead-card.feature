Feature: A card filed for him shows on the phone within a minute of its event, with no Refresh tap (mw-ev7oyy.37)

  Scenario: mw-ev7oyy.37: a To do filed under a list the phone holds shows on the To do board within a minute
    Given a stored view that holds the list "Errands" and the whole view was fetched a moment ago
    When a sync pages the event that a hitl:todo bead "Call the dentist" was filed under "Errands"
    Then the To do board lists "Call the dentist" under "Errands"
    And the whole view was not fetched and none waits for its window

  Scenario: mw-ev7oyy.37: a decision card filed for him shows on Needs you within a minute
    Given a stored view that holds the list "Errands" and the whole view was fetched a moment ago
    When a sync pages the event that a hitl:decision bead "Pick the paint" was filed under "Errands"
    Then Needs you holds a decision card "Pick the paint" with its Do this and Done when
    And the whole view was not fetched and none waits for its window

  Scenario: mw-ev7oyy.37: a new bead the phone cannot place still waits for the fifteen-minute window
    Given a stored view that holds the list "Errands" and the whole view was fetched a moment ago
    When a sync pages the event that a bead "Mail from elsewhere" was filed under a story the phone does not hold
    Then the whole view was not fetched now
    And the view is waited for until fifteen minutes after the last fetch, saying behind
