Feature: The legacy /snapshot fallback only reads a sealed snapshot (mw-44omaq.1)

  Scenario: mw-44omaq.1: a /snapshot body that is an HTML page is absent, not a decoder error
    Given the backend has no live view and answers /snapshot with the SPA's index.html
    When the phone refreshes the view
    Then the view is reported absent and nothing is saved

  Scenario: mw-44omaq.1: an empty /snapshot body is absent, not a decoder error
    Given the backend has no live view and answers /snapshot with an empty body
    When the phone refreshes the view
    Then the view is reported absent and nothing is saved

  Scenario: mw-44omaq.1: a sealed snapshot at /snapshot is still read
    Given the backend has no live view and answers /snapshot with a sealed snapshot
    When the phone refreshes the view
    Then the view is updated from the snapshot
