Feature: A busy factory on a live stream with no gap fetches the whole view once, at the start; every fetch says why (mw-7dige5.5)

  Scenario: mw-7dige5.5: ten minutes of a busy factory on a live stream fetch the view at the start and once for each card the home builds, not for the rest
    Given the event stream is live and the view was fetched at the start
    When ten minutes pass with the factory busy: new beads, steps closing, a hold, a landing, a story closed, pushes and a return to the app
    Then the whole view was fetched four times in all: the start, then one for each of the hold, the landing and the story closed, saying card
    And every ask for the view said why, a probe for the return to the app among them

  Scenario: mw-7dige5.5: a reconnect whose hello names another view fetches it once, saying reconnect
    Given the event stream is live and the view was fetched at the start
    When two quiet minutes on the stream drops and comes back naming another view
    Then two minutes on, the whole view was fetched twice in all, the second saying reconnect

  Scenario: mw-7dige5.5: a real gap in the seqs fetches the view once, saying gap
    Given the event stream is live and the view was fetched at the start
    When two quiet minutes on a batch comes that skips seqs
    Then two minutes on, the whole view was fetched twice in all, the second saying gap

  Scenario: mw-7dige5.5: what the phone cannot place is caught up once, fifteen minutes after the last fetch, saying behind
    Given the event stream is live and the view was fetched at the start
    When sixteen minutes pass with the factory busy but no hold, landing or story closed
    Then the whole view was fetched twice in all, the second fifteen minutes after the start, saying behind
