Feature: A send the backend took whose reply was lost is not sent twice (mw-jrx0s.23)

  Scenario: mw-jrx0s.23: a retry after a lost reply reaches the backend twice but is stored once under one txid
    Given the backend takes the first post but its reply is lost
    When he taps "Release" on bead "mw-a"
    And the sender is woken
    Then the backend was posted to 2 times
    And the backend stored 1 record
    And both posts were answered with the same txid
    And the outbox row is sent with that txid

  Scenario: mw-jrx0s.23: two taps with identical content are two records
    Given the backend answers every post
    When he taps "Release" on bead "mw-a" twice
    Then the backend stored 2 records
    And the two outbox rows carry different client ids

  Scenario: mw-jrx0s.23: the client id is in the row on the phone and survives a restart
    Given the backend takes the first post but its reply is lost
    When he taps "Release" on bead "mw-a"
    And the app is reloaded
    And the sender is woken
    Then the outbox row still carries the client id it had when first tried
    And the backend stored 1 record
