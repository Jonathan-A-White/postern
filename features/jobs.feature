Feature: The Jobs page shows each by-hand job's progress from a feed the factory keeps current (mw-6ww.166.1)

  Scenario: mw-6ww.166.1 AC2: Home shows a Jobs chip with the count of open jobs
    Given the backend has the job "subsplash-links" titled "Subsplash links" with 3 sermons, 1 done on every check, updated 5 minutes ago
    And the backend has the job "bulletins" titled "Bulletins" with 2 sermons, 2 done on every check, updated 5 minutes ago
    When Home opens
    Then the Jobs chip says "Jobs · 1 open"

  Scenario: mw-6ww.166.1 AC2: Home shows no Jobs chip while there is no job
    Given the backend has no jobs
    When Home opens
    Then the backend was asked for the jobs
    And Home shows no Jobs chip

  Scenario: mw-6ww.166.1 AC2: the Jobs page lists a job with its title, N of M done and when it was updated
    Given the backend has the job "subsplash-links" titled "Subsplash links" with 354 sermons, 120 done on every check, updated 5 minutes ago
    When the Jobs page opens
    Then the job "Subsplash links" says "120 of 354 done"
    And the job "Subsplash links" says "Updated 5 min ago"

  Scenario: mw-6ww.166.1 AC2: a job's page lists its items in the feed's order with a mark per check, and marks and scrolls to where you are
    Given the backend has the job "subsplash-links" titled "Subsplash links" with 4 sermons, 1 done on every check, updated 5 minutes ago
    When the page of the job "subsplash-links" opens
    Then the items are listed in the order "Sermon 1, Sermon 2, Sermon 3, Sermon 4"
    And the item "Sermon 1" has all three checks ticked
    And the item "Sermon 2" has its checks "mail" and "link" not yet done
    And the item "Sermon 2" is marked "You are here" and was scrolled to
    And the page says "Updated 5 min ago"

  Scenario: mw-6ww.166.1 AC3: a job whose items are all done shows Done and sits under the Done fold
    Given the backend has the job "subsplash-links" titled "Subsplash links" with 3 sermons, 1 done on every check, updated 5 minutes ago
    And the backend has the job "bulletins" titled "Bulletins" with 2 sermons, 2 done on every check, updated 5 minutes ago
    When the Jobs page opens
    Then the job "Subsplash links" is listed
    And the job "Bulletins" is not listed
    When the Done fold is opened
    Then the job "Bulletins" is now listed
    When the job "Bulletins" is opened
    Then the page says "Done"

  Scenario: mw-6ww.166.1 AC4: a job of 354 items draws every row within the test's budget
    Given the backend has the job "subsplash-links" titled "Subsplash links" with 354 sermons, 120 done on every check, updated 5 minutes ago
    When the page of the job "subsplash-links" opens
    Then all 354 items are drawn within 3000 ms of the feed arriving

  Scenario: mw-6ww.166.1 AC2: the Jobs page says so when the backend cannot be read, and Try again asks again
    Given the backend is down
    When the Jobs page opens
    Then the page says "The jobs could not be read"
    When the backend comes back with the job "subsplash-links" titled "Subsplash links" with 3 sermons, 1 done on every check, updated 5 minutes ago
    And Try again is tapped
    Then the job "Subsplash links" is listed
