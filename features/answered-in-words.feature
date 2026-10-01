Feature: A question answered in words goes dead like a tapped one (mw-gq6.199)

  Scenario: mw-gq6.199: a reply typed in the bead's thread that names an option greys the card out
    Given a question card on a bead with the options "Do A" and "Do B"
    When he typed "Let us do B" in that bead's thread after it was asked
    Then every option and "Answer in words" is disabled
    And the card says "Answered: Do B" and the time as HH:MM

  Scenario: mw-gq6.199: a reply typed in Factory that names an option and the bead greys the card out
    Given a question card on a bead with the options "Do A" and "Do B"
    When he typed "mw-q: go with do A please" in Factory after it was asked
    Then every option and "Answer in words" is disabled
    And the card says "Answered: Do A" and the time as HH:MM

  Scenario: mw-gq6.199: a reply typed in Factory naming no bead greys the only open question out
    Given the only open question card has the options "Do A" and "Do B"
    When he typed "Do A" in Factory after it was asked
    Then every option and "Answer in words" is disabled

  Scenario: mw-gq6.199: a reply typed in Factory naming no bead leaves one of two open questions live
    Given two open question cards, one on mw-q with the options "Do A" and "Do B"
    When he typed "Do A" in Factory after it was asked
    Then the options of the card on mw-q are still live

  Scenario: mw-gq6.199: a reply typed before the question was asked does not grey the card out
    Given a question card on a bead with the options "Do A" and "Do B"
    When he typed "Let us do B" in that bead's thread before it was asked
    Then the options of the card on mw-q are still live

  Scenario: mw-gq6.199: words that name no option leave the card live
    Given a question card on a bead with the options "Do A" and "Do B"
    When he typed "Let me think about it" in that bead's thread after it was asked
    Then the options of the card on mw-q are still live

  Scenario: mw-gq6.199: an ANSWER comment on the bead greys the card out
    Given a question card on a bead with the options "Do A" and "Do B"
    When the bead gets the comment "ANSWER 2026-10-01T13:20:00Z from 02ab, txid direct:aa: Do A" after it was asked
    Then every option and "Answer in words" is disabled
    And the card says "Answered: Do A" and the time as HH:MM

  Scenario: mw-gq6.199: an ANSWER comment from before the question was asked leaves the card live
    Given a question card on a bead with the options "Do A" and "Do B"
    When the bead gets the comment "ANSWER 2026-10-01T09:00:00Z from 02ab, txid direct:aa: Do A" before it was asked
    Then the options of the card on mw-q are still live
