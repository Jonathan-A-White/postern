Feature: The app keeps more than one account, and uses the active one (mw-9rp4hu.4)

  An account is a backend, the key that signs for it, its licence and its Ideas only setting. The phone
  that had one backend and one key yesterday has them as account 1, in place. The app's client, key,
  licence and cache follow the active account (accounts-screen.feature adds, switches, renames and removes them).

  Scenario: mw-9rp4hu.4 AC-1: yesterday's single account becomes account 1, active, with the same key and licence
    Given a phone that kept one key, one licence and some messages before accounts existed
    When the app opens
    Then there is one account and it is the active one
    And it has the same key and the same licence
    And the messages are still there

  Scenario: mw-9rp4hu.4 AC-1: switching the active account switches the backend and the key the client signs with
    Given a phone with account 1 and a second account on another backend
    When he switches to the second account and unlocks its key
    Then a call goes to the second account's backend, signed with its key
    When he switches back to the first account
    Then a call goes to the first account's backend, signed with its key
