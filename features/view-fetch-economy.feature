Feature: The whole view is fetched at the start, and again only on a real gap (mw-7dige5.1)

  Scenario: mw-7dige5.1: a busy hour fetches the view once, at the start
    Given the event stream is live, the view fetched at the start and events flowing
    When an hour passes with a view event every 30 seconds, each followed by its events batch
    Then the view was fetched once in all

  Scenario: mw-7dige5.1: a reconnect whose first batch follows on fetches nothing
    Given the event stream is live, the view fetched at the start and events flowing
    When the stream drops and comes back, and the first batch follows on from the last seq seen
    Then the view was fetched once in all

  Scenario: mw-7dige5.1: a reconnect with a gap in the seqs fetches the view once
    Given the event stream is live, the view fetched at the start and events flowing
    When the stream drops and comes back, and the first batch skips seqs
    Then the view was fetched twice in all

  Scenario: mw-7dige5.1: a batch that cannot be applied fetches the view once
    Given the event stream is live, the view fetched at the start and events flowing
    When a batch comes that cannot be applied
    Then the view was fetched twice in all

  Scenario: mw-7dige5.1: a reconnect after a start that could not reach the view fetches it
    Given the event stream is live and the view could not be fetched at the start
    When the stream drops and comes back, and the first batch follows on from the last seq seen
    Then the view was fetched once after the start
