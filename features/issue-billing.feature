Feature: The Key screen marks a licence holder API only, and keeps it (mw-cvwm1u.22)

  Scenario: mw-cvwm1u.22 AC-2: each issued licence's holder shows its billing, Max unless marked API only
    Given the backend bills one of two licence holders API only
    When the Key screen's Issued licences open
    Then the first holder's "API only" switch is off and its billing reads "Billing: Max"
    And the second holder's "API only" switch is on and its billing reads "Billing: API only"

  Scenario: mw-cvwm1u.22 AC-2: turning API only on is saved on the backend and kept across a reload
    Given the backend bills every licence holder Max
    When the Key screen's Issued licences open
    And I turn on the first holder's "API only" switch
    Then the backend was told to bill that holder api
    And the first holder's "API only" switch is on
    When the Key screen is opened again
    Then the first holder's "API only" switch is on

  Scenario: mw-cvwm1u.22 AC-2: a refused save puts the switch back and says why
    Given the backend refuses to save a billing mark with "only the Governor's key may mark a licence holder's billing"
    When the Key screen's Issued licences open
    And I turn on the first holder's "API only" switch
    Then the first holder's "API only" switch is off
    And I am told "Could not save: only the Governor's key may mark a licence holder's billing"

  Scenario: mw-cvwm1u.22 AC-2: when the marks cannot be read the switches are off the table and say so
    Given the backend cannot give the billing marks
    When the Key screen's Issued licences open
    Then every "API only" switch is disabled
    And I am told "Billing is not loaded"
