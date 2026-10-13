Feature: A shots run never fails on a leftover preview server, and leaves none behind (mw-gq6.403)

  Scenario: AC-1: a leftover vite preview from this checkout on the preview port is stopped, then the server starts
    Given a leftover "vite preview" from this checkout is listening on the preview port
    When the guard starts the preview server for that port
    Then the leftover is gone
    And the new server is listening on the preview port

  Scenario: AC-1: a listener on the port that is not a vite preview from this checkout is left alone
    Given a listener that is not a vite preview from this checkout is on the preview port
    When the guard looks for a leftover on that port
    Then it stops nothing
    And the listener is still there

  Scenario: AC-2: nothing listens on the preview port once the run ends
    Given the guard is running the preview server on the preview port
    When the run ends
    Then nothing listens on the preview port

  Scenario: AC-2: nothing listens on the preview port after the run is interrupted
    Given the guard is running the preview server on the preview port
    When the run is interrupted with Ctrl+C
    Then nothing listens on the preview port
