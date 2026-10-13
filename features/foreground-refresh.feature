Feature: The app catches up when it returns from the background (mw-t64a3.17)

  Scenario: AC-1: becoming visible syncs the events, which fetch the view once for a new bead, however often it fires
    Given the factory is connected and a bead is filed while the app was away
    When the app becomes visible
    And the app becomes visible again a moment later
    Then the view was fetched once more
    And the new bead is in the store

  Scenario: AC-1b: coming back from the bfcache syncs the events too
    Given the factory is connected and a bead is filed while the app was away
    When the page is shown again from the back-forward cache
    Then the view was fetched once more
    And the new bead is in the store

  Scenario: mw-7dige5.1: becoming visible with nothing new fetches no view
    Given the factory is connected and nothing was filed while the app was away
    When the app becomes visible
    Then the view was not fetched again

  Scenario: mw-7dige5.1: becoming visible asks whether home is up without asking for the view
    Given the factory is connected and nothing was filed while the app was away
    When the app becomes visible
    Then the backend was asked about the view with If-None-Match *, which it answers with no body

  Scenario: AC-2: becoming visible with a dead stream reconnects it
    Given the factory is connected and a bead is filed while the app was away
    And the stream went silent long enough to be dead
    When the app becomes visible
    Then the event stream was opened again

  Scenario: AC-2b: becoming visible with a healthy stream leaves it be
    Given the factory is connected and a bead is filed while the app was away
    When the app becomes visible
    Then the event stream was not opened again
