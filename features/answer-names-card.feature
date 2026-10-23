Feature: An answer names the question card it answers, so one tap marks one card (mw-1cfk7g.1)

  Scenario: mw-1cfk7g.1: a tap on the first of two cards on a bead sends that card's id and marks only that card
    Given two question cards on one bead, the first with "Weekly" and "Per demo", the second with "Rebase" and "Merge"
    When he taps "Weekly" on the first card
    Then the answer sent names the first card
    And the first card says "Answered: Weekly" and the second card offers "Rebase" and "Merge"

  Scenario: mw-1cfk7g.1: a needs card for the second question stays open when the record names the first card
    Given a needs card for the second of two question cards on one bead
    And this phone's record of his answer "Weekly" names the first card
    When the needs card is shown
    Then every option on the needs card is enabled and it does not say "Answered"

  Scenario: mw-1cfk7g.1: after a reload an answer record naming the first card leaves the second card open
    Given two question cards on one bead, the first with "Weekly" and "Per demo", the second with "Rebase" and "Merge"
    And this phone's record of his answer "Weekly" names the first card
    When the conversation is shown
    Then the first card says "Answered: Weekly" and the second card offers "Rebase" and "Merge"

  Scenario: mw-gq6.733: the factory's ANSWER comment for the first card's answer does not mark the second card
    Given two question cards on one bead, the first with "Weekly" and "Per demo", the second with "Rebase" and "Merge"
    And this phone's record of his answer "Weekly" names the first card
    And the factory's ANSWER comment on the bead repeats "Weekly" with that answer's id
    When the conversation is shown
    Then the first card says "Answered: Weekly" and the second card offers "Rebase" and "Merge"

  Scenario: mw-gq6.733: the factory's ANSWER comment for the first card's answer does not mark the second card's needs card
    Given a needs card for the second of two question cards on one bead
    And this phone's record of his answer "Weekly" names the first card
    And the factory's ANSWER comment on the bead repeats "Weekly" with that answer's id
    When the needs card is shown
    Then every option on the needs card is enabled and it does not say "Answered"

  Scenario: mw-gq6.733: an ANSWER comment whose answer names no card still marks the card it was written after
    Given two question cards on one bead, the first with "Weekly" and "Per demo", the second with "Rebase" and "Merge"
    And the factory's ANSWER comment on the bead says "Rebase" and its answer names no card
    When the conversation is shown
    Then the second card says "Answered: Rebase"
