Feature: An answer he stopped stays heard, even when its record is stored again as he stops it (mw-gq6.912)

  Scenario: mw-gq6.912: a Stop that lands while the answer's record is being stored again is not lost
    Given the Mayor's talk answer is on the phone and he has not heard it
    When the phone stores the same record again and he stops the answer while that is being stored
    Then the stored answer is marked heard

  Scenario: mw-gq6.912: an answer stored again after he heard it stays heard
    Given the Mayor's talk answer is on the phone and he has not heard it
    And he stopped the answer
    When the phone stores the same record again
    Then the stored answer is marked heard
