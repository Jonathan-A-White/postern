Feature: The whole view is fetched at most once a minute, and only when it has moved (mw-7dige5.4)

  Scenario: mw-7dige5.4: a hello naming the view the phone already holds fetches nothing
    Given the event stream is live and the view was fetched at the start
    When the stream says hello naming that same view
    Then two minutes on, the view has been fetched once in all

  Scenario: mw-7dige5.4: a hello naming another view fetches it, asking with the ETag held, when the minute is out
    Given the event stream is live and the view was fetched at the start
    When five seconds on the stream says hello naming another view
    Then at once the view has been fetched once in all
    And a minute on, the view has been fetched twice in all, the second time asking with the ETag held

  Scenario: mw-7dige5.4: screens asking for the view inside the minute make one fetch when it is out
    Given the event stream is live and the view was fetched at the start
    When five screens ask for the view over the next thirty seconds
    Then at once the view has been fetched once in all
    And a minute on, the view has been fetched twice in all, the second time asking with the ETag held

  Scenario: mw-7dige5.4: a tap on the Needs you Refresh button fetches at once, inside the minute, asking with the ETag held
    Given the event stream is live and the view was fetched at the start
    When five seconds on Refresh is tapped on the Needs you screen
    Then the view has been fetched twice in all, the second time asking with the ETag held
    And two minutes on, the view has been fetched twice in all
