Feature: A question is answered once, in the conversation and on a card, and it reads answered after a reload (mw-f758y.32)

  Scenario: mw-f758y.32: a question in the conversation answers once and a second tap sends nothing
    Given a question in the conversation with the options "Yes" and "No"
    When he taps "No" in the conversation
    And he taps "Yes" again in the conversation
    Then the conversation sent one answer, "No"
    And the conversation's options are disabled
    And the conversation card says "Answered: No" and the time as HH:MM

  Scenario: mw-f758y.32: a question answered before a reload still reads answered
    Given a question in the conversation that he answered "Yes" a minute after it was asked
    When the conversation is shown
    Then the conversation's options are disabled
    And the conversation card says "Answered: Yes" and the time as HH:MM

  Scenario: mw-f758y.32: a second question on the bead is not held by the first one's answer
    Given a conversation whose first question he answered "Yes", and which asked a second one
    When the conversation is shown
    Then the first card says "Answered: Yes" and the second card offers "Red" and "Blue"

  Scenario: mw-f758y.32: an answer that failed to send leaves the card tappable and says so
    Given a question in the conversation with the options "Yes" and "No"
    And sending an answer fails
    When he taps "Yes" in the conversation
    Then the conversation's options are enabled
    And the conversation card reads "Your answer did not send"

  Scenario: mw-f758y.32: a needs card whose answer is on this phone's record stays dead after a reload
    Given a question card with the options "Yes" and "No", which he answered "No" a minute after it was asked
    When the card is shown
    Then every option and "Answer in words" is disabled
    And the card says "Answered: No" and the time as HH:MM
