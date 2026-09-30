Feature: Issuing a licence to another key, and ending it (mw-yjxcw.3)

  Scenario: AC1: issuing to a valid key in cairn broadcasts one mint and records a pending spend
    Given I hold enough sats to issue a licence
    When I issue a licence to a valid key in cairn
    Then one transaction is broadcast through the backend
    And its output 0 is a licence to that key
    And its mint record names cairn and that key's address
    And the spend is remembered as pending

  Scenario: AC2: issuing to my own key is refused before anything is fetched
    Given I hold enough sats to issue a licence
    When I issue a licence to my own key
    Then it is refused as my own key
    And nothing was fetched

  Scenario: AC3: an invalid key is refused
    Given I hold enough sats to issue a licence
    When I issue a licence to something that is not a public key
    Then it is refused as an invalid key
    And nothing was fetched

  Scenario: AC4: not enough sats is a clear error
    Given I hold too few sats to issue a licence
    When I issue a licence to a valid key in cairn
    Then it is refused for not enough sats
    And nothing is broadcast

  Scenario: AC5: revoking writes a revoke record naming the origin from my key
    Given I hold enough sats to issue a licence
    When I revoke the licence at a given origin
    Then one transaction is broadcast through the backend
    And it carries a revoke record naming that origin
    And it is signed by my key

  Scenario: AC6: the licences I issued are listed, revoked ones marked, and others' mints left out
    Given the chain holds a mint I signed, a revoke of it I signed, a second mint I signed, and a mint someone else signed
    When I list the licences I issued
    Then I see two licences, the newest first
    And the first mint is marked revoked
    And the second is not

  Scenario: AC7: revoking a licence this key did not issue is refused and spends nothing
    Given I hold enough sats to issue a licence
    And the chain holds a mint that someone else signed
    When I revoke that licence
    Then it is refused as not issued
    And nothing is broadcast
    And no coin was fetched or recorded as spent

  Scenario: AC8: a revoke whose origin differs only in letter case shows the licence as revoked
    Given the chain holds a mint I signed and a revoke of it I signed that names the origin in capitals
    When I list the licences I issued
    Then I see one licence and it is marked revoked
