Feature: A busy factory on a live stream with no gap fetches the whole view once, at the start; every fetch says why (mw-7dige5.5)

  Scenario: mw-7dige5.5: ten minutes of a busy factory on a live stream with no gap fetch the view once, at the start
    Given the event stream is live and the view was fetched at the start
    When ten minutes pass with the factory busy: new beads, steps closing, a hold, a landing, a story closed, pushes and a return to the app
    Then the whole view was fetched once in all
    And every ask for the view said why: the start, and a probe for each return to the app

  Scenario: mw-7dige5.5: a reconnect whose hello names another view fetches it once, saying reconnect
    Given the event stream is live and the view was fetched at the start
    When two quiet minutes on the stream drops and comes back naming another view
    Then two minutes on, the whole view was fetched twice in all, the second saying reconnect

  Scenario: mw-7dige5.5: a real gap in the seqs fetches the view once, saying gap
    Given the event stream is live and the view was fetched at the start
    When two quiet minutes on a batch comes that skips seqs
    Then two minutes on, the whole view was fetched twice in all, the second saying gap

  Scenario: mw-7dige5.5: what only the home can build is caught up once, fifteen minutes after the last fetch, saying behind
    Given the event stream is live and the view was fetched at the start
    When sixteen minutes pass with the factory busy
    Then the whole view was fetched twice in all, the second fifteen minutes after the start, saying behind
