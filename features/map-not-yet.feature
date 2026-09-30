Feature: The Map says "Not on the map yet" for a fresh open epic the phone's view predates (mw-t64a3.28)

  Scenario: mw-t64a3.28: an open epic missing from the view is "Not on the map yet" and the view is refreshed once
    Given the phone's view does not hold the epic "mw-fresh"
    And the backend says "mw-fresh" is open
    When the Map is opened focused on "mw-fresh"
    Then the Map says "Not on the map yet"
    And it says "mw-fresh" is open but the map on this phone is older than it
    And an "Open it anyway" link is shown
    And the view was asked to refresh once

  Scenario: mw-t64a3.28: the epic shows focused, with no second tap, once a later view holds it
    Given the phone's view does not hold the epic "mw-fresh"
    And the backend says "mw-fresh" is open
    When the Map is opened focused on "mw-fresh"
    Then the Map says "Not on the map yet"
    When a later view arrives holding the epic "mw-fresh"
    Then the Map shows the epic "mw-fresh" focused
    And "Not on the map yet" is gone

  Scenario: mw-t64a3.28: an epic the backend says is closed keeps the "Not in the live view" text
    Given the phone's view does not hold the epic "mw-old"
    And the backend says "mw-old" is closed
    When the Map is opened focused on "mw-old"
    Then the Map says "Not in the live view"
    And it says "mw-old" may have closed more than a week ago
    And the view was not asked to refresh

  Scenario: mw-t64a3.28: an epic the backend cannot be asked about keeps the "Not in the live view" text
    Given the phone's view does not hold the epic "mw-gone"
    And the backend cannot be asked about "mw-gone"
    When the Map is opened focused on "mw-gone"
    Then the Map says "Not in the live view"
    And it says "mw-gone" may have closed more than a week ago
    And the view was not asked to refresh
