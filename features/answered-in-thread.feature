Feature: A decision card in a bead's thread goes dead when he answers it in words, like Needs you (mw-gq6.214)

  Scenario: mw-gq6.214: a reply typed in the bead's channel that names an option greys the card in its thread out
    Given a question post on a bead with the options "Do A" and "Do B", open in its thread
    When he typed "Do A" in that bead's channel after it was asked
    Then every option on the post is disabled
    And the post says "Answered: Do A" and the time as HH:MM

  Scenario: mw-gq6.214: a reply typed in Factory that names an option and the bead greys the card in its thread out
    Given a question post on a bead with the options "Do A" and "Do B", open in its thread
    When he typed "mw-q: go with do B please" in Factory after it was asked
    Then every option on the post is disabled
    And the post says "Answered: Do B" and the time as HH:MM

  Scenario: mw-gq6.214: an ANSWER comment on the bead greys the card in its thread out
    Given a question post on a bead with the options "Do A" and "Do B", open in its thread
    When the bead gets the comment "ANSWER 2026-10-01T13:20:00Z from 02ab, txid direct:aa: Do A" after it was asked
    Then every option on the post is disabled
    And the post says "Answered: Do A" and the time as HH:MM

  Scenario: mw-gq6.214: an answer he tapped still greys the card in its thread out
    Given a question post on a bead with the options "Do A" and "Do B", open in its thread
    When he tapped "Do B" on that bead after it was asked
    Then every option on the post is disabled
    And the post says "Answered: Do B" and the time as HH:MM

  Scenario: mw-gq6.214: words that name no option leave the card in its thread live
    Given a question post on a bead with the options "Do A" and "Do B", open in its thread
    When he typed "Let me think about it" in that bead's channel after it was asked
    Then the options on the post are still live

  Scenario: mw-gq6.214: words typed before the question was asked leave the card in its thread live
    Given a question post on a bead with the options "Do A" and "Do B", open in its thread
    When he typed "Do A" in that bead's channel before it was asked
    Then the options on the post are still live

  Scenario: mw-gq6.214: words typed in Factory naming no bead leave the card live when the one open question is another bead's
    Given a question post on a bead with the options "Do A" and "Do B", open in its thread
    And the only open question is on another bead
    When he typed "Do A" in Factory after it was asked
    Then the options on the post are still live

  Scenario: mw-gq6.214: a reply typed in a card's thread appears in that thread at once
    Given a question post on a bead with the options "Do A" and "Do B", open in its thread
    When he types "Let me think about it" in the thread's Reply… composer and sends it
    Then the thread shows the question and then "Let me think about it"
    And the options on the post are still live

  Scenario: mw-gq6.214: a reply naming an option typed in a card's thread appears there and greys the card out
    Given a question post on a bead with the options "Do A" and "Do B", open in its thread
    When he types "Do A" in the thread's Reply… composer and sends it
    Then the thread shows the question and then "Do A"
    And every option on the post is disabled
    And the post says "Answered: Do A" and the time as HH:MM

  Scenario: mw-gq6.222: a reply naming a lettered option by its letter greys the card in its thread out
    Given a question post on a bead with the lettered options "A: It greyed out" and "B: It did not", open in its thread
    When he typed "Do A" in that bead's channel after it was asked
    Then every option on the lettered post is disabled
    And the post says "Answered: A: It greyed out" and the time as HH:MM
