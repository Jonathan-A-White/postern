Feature: A shots run counts the tests it ran again for a detached page (mw-6ww.175.61)

  Scenario: AC-1: the last line of a shots run says how many tests were retried for a detached page
    Given the first attempt of a test was ended because its page's target detached during setup
    And the test is run again
    When the shots run ends
    Then its last line reads "shots: 1 test retried for a detached page (390x844: 1)"

  Scenario: AC-1: a failure of another kind is not counted
    Given the first attempt of a test failed on an assertion
    When the shots run ends
    Then its last line reads "shots: 0 tests retried for a detached page"
