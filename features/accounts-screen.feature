Feature: Settings > Accounts adds, switches, renames and removes accounts (mw-9rp4hu.5)

  Each account is a backend and the key that signs for it. The Me screen lists them with the active one marked;
  Add account takes a backend address, a name and a choice of key (this phone's by default) and checks the key with
  that backend before keeping anything. With two or more accounts every screen's top bar names the active one and a
  tap switches. With one account nothing about the top bar changes.

  Scenario: mw-9rp4hu.5 AC-1: an account is added with this phone's key, checked with its backend, and the app switches to it and back
    Given an unlocked phone with one account
    When he adds the account "Luke's factory" at "https://luke.example/api" with this phone's key
    Then the backend was asked about this phone's key
    And the Accounts list shows "Postern" as active and "Luke's factory"
    When he switches to "Luke's factory"
    Then "Luke's factory" is the active account and calls go to "https://luke.example/api"
    When he switches to "Postern"
    Then "Postern" is the active account and calls go to "/api"

  Scenario: mw-9rp4hu.5 AC-1: a backend that cannot be reached adds nothing
    Given an unlocked phone with one account
    When he adds the account "Down" at "https://down.example/api" with this phone's key
    Then the form says the key could not be checked with "https://down.example/api"
    And the Accounts list shows only "Postern"

  Scenario: mw-9rp4hu.5 AC-1: a backend that says the key holds no licence is added, with a line saying so
    Given an unlocked phone with one account
    When he adds the account "Unlicensed" at "https://nolicence.example/api" with this phone's key
    Then the form says that backend holds no licence for the key
    And the Accounts list shows "Postern" as active and "Unlicensed"

  Scenario: mw-9rp4hu.5 AC-1: a new key is added unchecked, and its account opens at its own door
    Given an unlocked phone with one account
    When he adds the account "Fresh" at "https://fresh.example/api" with a new key
    Then the Accounts list shows "Postern" as active and "Fresh"
    When he switches to "Fresh"
    Then "Fresh" is the active account with no key unlocked

  Scenario: mw-9rp4hu.5 AC-2: the top bar names no account when there is one, and names the active one when there are two
    Given an unlocked phone with one account
    Then the top bar names no account
    When he adds the account "Luke's factory" at "https://luke.example/api" with this phone's key
    Then the top bar names "Postern"
    When he taps the account name in the top bar and chooses "Luke's factory"
    Then the top bar names "Luke's factory"

  Scenario: mw-9rp4hu.5 AC-1: an account is renamed, and removed only after a confirm, its key staying on the phone
    Given an unlocked phone with one account
    When he adds the account "Luke's factory" at "https://luke.example/api" with this phone's key
    And he renames "Luke's factory" to "Luke"
    Then the Accounts list shows "Postern" as active and "Luke"
    When he asks to remove "Luke" and keeps it
    Then "Luke" is still on the Accounts list
    When he asks to remove "Luke" and confirms
    Then the Accounts list shows only "Postern"
    And the removed account's key is still in its store
