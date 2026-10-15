Feature: The launch never sits on a padlock with no word (mw-4gkijo.1)

  Scenario: mw-4gkijo.1 AC-2: opening the database runs no history-wide clean-up
    Given the phone holds a real message, its chain twin and a row an older build stored from an events record
    When the database is closed and opened again
    Then all three rows are still stored

  Scenario: mw-4gkijo.1 AC-2: once the app is shown the clean-ups remove what they always removed
    Given the phone holds a real message, its chain twin and a row an older build stored from an events record
    When the app is opened on a phone with a key set up
    Then the door is shown
    And the events row and the chain twin are removed and the direct message stays

  Scenario: mw-4gkijo.1 AC-3: a vault that cannot be read shows the error with Try again, not Loading
    Given the vault cannot be read
    When the app is opened on a phone with a key set up
    Then the screen says the vault could not be opened, with the reason
    And a Try again button is there, and tapping it reloads the page

  Scenario: mw-4gkijo.1 AC-3: an earlier unlock that cannot be read is said on the Unlock screen's error line
    Given the kept session cannot be read
    When the app is opened on a phone with a key set up
    Then the door is shown
    And the Unlock screen's error line says the earlier unlock could not be read

  Scenario: mw-4gkijo.1 AC-4: a blocked database open shows the waiting text and recovers on Try again
    Given another window holds an older copy of the database open
    When the app is opened on a phone with a key set up
    Then the screen says another Postern window is holding the database, with a Try again button
    When the other window lets go and Try again is tapped
    Then the app is on its door, no longer on Loading

  Scenario: mw-4gkijo.1 AC-4: a database upgraded by another window is let go, said so and reloaded once
    Given the app is open on a phone with a key set up
    When another window upgrades the database
    Then the screen says Postern was updated in another window
    And the page is reloaded once, however many times the database changes

  Scenario: mw-4gkijo.1 AC-5: Loading says what it waits on after 3 s and offers Try again after 10 s
    Given the app is loading on a clock the test moves
    When 2.9 seconds have passed
    Then Loading says nothing yet
    When 3 seconds have passed
    Then Loading says Opening your vault
    When 9.9 seconds have passed
    Then Loading offers no Try again yet
    When 10 seconds have passed
    Then Loading offers Try again, and tapping it reloads the page
