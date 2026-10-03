Feature: Any message or card can be shared out of the app (mw-gq6.252)

  Scenario: AC-1: Share on a message opens the phone's share sheet with its readable text and the channel's name
    Given a conversation in the channel Factory with a message and a question card
    And the phone has a share sheet
    When Share is tapped on the message
    Then the share sheet gets the message's words with the title Postern: Factory

  Scenario: AC-2: Share on a question card shares the question and each option as a line
    Given a conversation in the channel Factory with a message and a question card
    And the phone has a share sheet
    When Share is tapped on the question card
    Then the share sheet gets the question and its options as lines

  Scenario: AC-3: Without a share sheet Share copies the text and says Copied
    Given a conversation in the channel Factory with a message and a question card
    And the phone has no share sheet
    When Share is tapped on the message
    Then the clipboard holds the message's words
    And the button says Copied

  Scenario: AC-4: Share on a live card shares its title and numbered items
    Given a live card with two items
    And the phone has a share sheet
    When Share is tapped on the card
    Then the share sheet gets the card as lines
