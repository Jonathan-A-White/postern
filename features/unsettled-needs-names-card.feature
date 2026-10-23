Feature: An answer settles only the question card it names, in the Needs you list, its badge and the bead page (mw-gq6.735)

  Scenario: mw-gq6.735: an answer naming the first of two cards on a bead leaves the second card waiting
    Given two question cards on one bead, the second asked after the first
    And an answer sent after both that names the first card
    When the needs still waiting on him are listed
    Then only the second card is listed

  Scenario: mw-gq6.735: an answer naming no card settles the cards asked before it, as before
    Given two question cards on one bead, the second asked after the first
    And an answer sent between the two that names no card
    When the needs still waiting on him are listed
    Then only the second card is listed
