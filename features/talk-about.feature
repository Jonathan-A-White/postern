Feature: A Talk button wherever he meets the Mayor opens the Talk line about that thing, and the talk's first turn says what it is about (mw-nqur1n.6)

  Scenario: mw-nqur1n.6: Talk on a decision card opens the line about the card's title
    Given a decision card "Pick the colour" on the bead "mw-card"
    When Talk is tapped on the card
    Then the Talk line is open
    And the line says "About: Pick the colour"

  Scenario: mw-nqur1n.6: the first turn's record carries about, the next turn does not
    Given a decision card "Pick the colour" on the bead "mw-card"
    When Talk is tapped on the card
    And he holds the button and says "Go with blue"
    Then the turn sent is turn 1 and its about is kind "bead", id "mw-card", title "Pick the colour"
    When he holds the button again and says "And why not green"
    Then the turn sent is turn 2 and carries no about

  Scenario: mw-nqur1n.6: Talk on a step for his hands opens the line about the bead
    Given a card of hands on the bead "mw-hands" titled "Move the disk" with the step "s1"
    When Talk is tapped on the step "s1"
    Then the line says "About: Move the disk"
    When he holds the button and says "Is this safe"
    Then the turn sent is turn 1 and its about is kind "bead", id "mw-hands", title "Move the disk"

  Scenario: mw-nqur1n.6: Talk in a named channel's header opens the line about the channel
    Given the channel "garden" is open
    When Talk is tapped in the header
    Then the line says "About: garden"
    When he holds the button and says "Where were we"
    Then the turn sent is turn 1 and its about is kind "channel", id "topic:garden", title "garden"

  Scenario: mw-nqur1n.6: Talk on a Prompts row carries kind prompt
    Given the prompts screen lists "top5"
    When Talk is tapped on the row "/top5"
    Then the line says "About: /top5"
    When he holds the button and says "Make it shorter"
    Then the turn sent is turn 1 and its about is kind "prompt", id "top5", title "/top5"

  Scenario: mw-nqur1n.6: Clear drops the about
    Given a decision card "Pick the colour" on the bead "mw-card"
    When Talk is tapped on the card
    And Clear is tapped beside the about
    Then the line says no About
    When he holds the button and says "Hello"
    Then the turn sent is turn 1 and carries no about

  Scenario: mw-nqur1n.6: an about survives the turn's encoding and is left out when there is none
    Given a turn 1 of talk "talk-a" about the bead "mw-x" titled "A title"
    When the turn is encoded and decoded
    Then the decoded turn still says it is about the bead "mw-x" titled "A title"
    And a turn with a malformed about decodes without one

  Scenario: mw-nqur1n.6: the line's address carries the about and reads it back
    Given the line address for the prompt "top5" titled "/top5"
    Then reading that address gives the same about
