Feature: A decision card's long options stack and wrap, and nothing is wider than the screen (mw-gq6.172)

  Scenario: mw-gq6.172: three long options are stacked full-width buttons whose words wrap
    Given a phone 360 px wide and a question with three options of about 200 characters each
    When the conversation is shown
    Then the options are stacked one under the other
    And every option button is as wide as the card, wraps its words and grows taller than one line
    And the letter and colon that start an option are bold
    And the recommended option keeps its primary look and its "rec." mark

  Scenario: mw-gq6.172: nothing in the conversation is wider than the viewport
    Given a phone 360 px wide and a question with three options of about 200 characters each
    When the conversation is shown
    Then the conversation list is no wider than its own box
    And the answer chip is allowed to shrink to the screen and not to run past it

  Scenario: mw-gq6.172: short options stay in one row
    Given a question with the options "Yes" and "No"
    When the conversation is shown
    Then the options sit in a wrapping row, as before

  Scenario: mw-gq6.172: a tap on a long option still sends the whole option text
    Given a phone 360 px wide and a question with three options of about 200 characters each
    And the conversation is shown
    When he taps the second option
    Then the answer sent is the second option's full text
