Feature: Talk turns reach the Mayor in the order he spoke them, each once (mw-q6n8m0.12)

  Scenario: mw-q6n8m0.12 AC-1: a turn the backend refused holds back the turns he spoke after it until he taps Retry
    Given the backend is up
    And the backend refuses the Talk turn "turn four" for good, saying "not allowed"
    When he says "turn four", "turn five" and "turn six" on the Talk line
    Then the Mayor has heard no turns
    And "turn five" and "turn six" still show as waiting to go
    When the backend lets "turn four" through and he taps Retry on it
    Then the Mayor heard "turn four", "turn five" and "turn six", in that order, once each

  Scenario: mw-q6n8m0.12 AC-1: a turn that went on the chain holds back the turns after it until its record is seen
    Given the backend is up
    And the Talk turn "turn four" goes on the chain because the backend cannot be reached for it
    When he says "turn four", "turn five" and "turn six" on the Talk line
    Then the Mayor has heard only "turn four"
    And "turn five" and "turn six" still show as waiting to go
    When the record of "turn four" comes back from the chain
    Then the Mayor heard "turn four", "turn five" and "turn six", in that order, once each
