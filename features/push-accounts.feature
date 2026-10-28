Feature: Pushes per account

  Scenario: mw-9rp4hu.23 AC1: a push is shown from the database of the account it is for, whichever account is open
    Given two accounts that keep different notification switches for a message
    When a message is pushed to the second account's registration, then to the first's
    Then the second account's notification is silent and the first account's sounds
    And a tap on the second account's notification told the window to switch to the second account

  Scenario: mw-9rp4hu.23 AC1: with one account a push behaves as it did
    Given one account that keeps the default notification switches
    When a message is pushed to the app's own registration
    Then the notification sounds and nothing in it names an account other than the first

  Scenario: mw-9rp4hu.23 AC2: each account subscribes with its own backend
    Given a second account on another backend
    When both accounts turn notifications on
    Then each backend was asked for its own key and given its own subscription, from its own registration

  Scenario: mw-9rp4hu.23 AC2: removing an account unsubscribes it
    Given a second account on another backend that has notifications on
    When the second account is removed
    Then its subscription is cancelled and its registration dropped, and the first account's push stays on
