Feature: The app catches up when it returns from the background (mw-t64a3.17)

  Scenario: AC-1: becoming visible fetches the view, once however often it fires
    Given the factory is connected and a bead is filed while the app was away
    When the app becomes visible
    And the app becomes visible again a moment later
    Then the view was fetched once more
    And the new bead is in the store

  Scenario: AC-1b: coming back from the bfcache refreshes the view too
    Given the factory is connected and a bead is filed while the app was away
    When the page is shown again from the back-forward cache
    Then the view was fetched once more
    And the new bead is in the store

  Scenario: AC-2: becoming visible with a dead stream reconnects it
    Given the factory is connected and a bead is filed while the app was away
    And the stream went silent long enough to be dead
    When the app becomes visible
    Then the event stream was opened again

  Scenario: AC-2b: becoming visible with a healthy stream leaves it be
    Given the factory is connected and a bead is filed while the app was away
    When the app becomes visible
    Then the event stream was not opened again
