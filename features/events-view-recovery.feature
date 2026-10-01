Feature: Once the factory's events flow, the stream's view event is the recovery path only (mw-jrx0s.7)

  Scenario: mw-jrx0s.7: before any events batch, a view event fetches the view at once
    Given the event stream is live and no events batch has come this session
    When the stream says the view changed
    Then the view is fetched at once

  Scenario: mw-jrx0s.7: once events flow, a view event that a batch follows fetches nothing
    Given the event stream is live and an events batch was applied a minute ago
    When the stream says the view changed and a batch follows it
    Then ten seconds on, the view has not been fetched

  Scenario: mw-jrx0s.7: once events flow, a view event that no batch follows fetches the view
    Given the event stream is live and an events batch was applied a minute ago
    When the stream says the view changed and nothing follows it
    Then ten seconds on, the view has been fetched once
